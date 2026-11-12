/**
 * Turning price history into what a person needs: a step line per store, and insights in words.
 * Pure functions (tested in scripts/test-history.mts).
 */

export type Change = {
  store_key: string;
  changed_at: string;
  old_price: number | null;
  new_price: number;
};
export type Point = { t: number; price: number };
export type Series = { store: string; points: Point[]; current: number };

const ts = (iso: string) =>
  new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z").getTime();

/**
 * A step series per store: the price holds until the next change (prices change in jumps, not gradually).
 * The line is clipped to the start of the range (from) and extends to "now" (to) at the current price.
 */
export function buildSeries(
  changes: Change[],
  from: number,
  to: number,
): Series[] {
  const by = new Map<string, Change[]>();
  for (const c of changes) {
    if (!by.has(c.store_key)) by.set(c.store_key, []);
    by.get(c.store_key)!.push(c);
  }
  const out: Series[] = [];
  for (const [store, list] of by) {
    list.sort((a, b) => ts(a.changed_at) - ts(b.changed_at));
    const points: Point[] = [];
    for (const c of list) {
      const t = ts(c.changed_at);
      const price = Number(c.new_price);
      if (t <= from) {
        // a point from before the range = the starting price at the edge of the range
        if (points.length && points[0].t === from)
          points[0] = { t: from, price };
        else points.unshift({ t: from, price });
      } else points.push({ t, price });
    }
    if (!points.length) continue;
    const current = points[points.length - 1].price;
    points.push({ t: to, price: current });
    out.push({ store, points, current });
  }
  return out.sort((a, b) => a.current - b.current);
}

/** The price at time t (step semantics). */
export function priceAt(s: Series, t: number): number | null {
  let p: number | null = null;
  for (const pt of s.points) {
    if (pt.t <= t) p = pt.price;
    else break;
  }
  return p;
}

export type Insight = { kind: "up" | "down" | "low" | "info"; text: string };

/** Insights in plain words - the answer before the chart. */
export function insights(
  series: Series[],
  from: number,
  storeName: (k: string) => string,
  ils: (n: number) => string,
): Insight[] {
  const out: Insight[] = [];
  if (!series.length) return out;
  const cheapest = series[0];
  // The biggest change in the range (the last price vs the starting price), per store
  let biggest: { s: Series; pct: number } | null = null;
  for (const s of series) {
    const start = priceAt(s, from) ?? s.points[0].price;
    if (!start) continue;
    const pct = (s.current - start) / start;
    if (
      Math.abs(pct) >= 0.03 &&
      (!biggest || Math.abs(pct) > Math.abs(biggest.pct))
    )
      biggest = { s, pct };
  }
  if (biggest) {
    const up = biggest.pct > 0;
    out.push({
      kind: up ? "up" : "down",
      text: `${up ? "עלה" : "ירד"} ${Math.round(Math.abs(biggest.pct) * 100)}% ב${storeName(biggest.s.store)} (עכשיו ${ils(biggest.s.current)})`,
    });
  }
  // The lowest price in the range across all stores, if it's lower than today's
  let low: { price: number; store: string } | null = null;
  for (const s of series)
    for (const p of s.points)
      if (!low || p.price < low.price) low = { price: p.price, store: s.store };
  if (low && low.price < cheapest.current - 0.005) {
    out.push({
      kind: "low",
      text: `המחיר הנמוך בתקופה: ${ils(low.price)} ב${storeName(low.store)}`,
    });
  }
  const spread =
    series.length > 1
      ? series[series.length - 1].current - cheapest.current
      : 0;
  if (spread >= 0.5) {
    out.push({
      kind: "info",
      text: `הפער בין הסניפים: ${ils(spread)} (${Math.round((spread / series[series.length - 1].current) * 100)}%)`,
    });
  }
  return out;
}

// ---------- cheaper alternatives ----------

/** Size in a base unit: grams / millilitres / units. null = can't compare. */
export function normalizedSize(
  quantity: number | null,
  unit: string | null,
): { family: "g" | "ml" | "u"; amount: number } | null {
  if (!quantity || quantity <= 0 || !unit) return null;
  const u = unit.replace(/\s/g, "");
  if (/קילוגרם|ק"ג|קג/.test(u)) return { family: "g", amount: quantity * 1000 };
  if (/גרם/.test(u)) return { family: "g", amount: quantity };
  if (/מיליליטר|מ"ל|מל$/.test(u)) return { family: "ml", amount: quantity };
  if (/ליטר/.test(u))
    return { family: "ml", amount: quantity < 20 ? quantity * 1000 : quantity };
  if (/יחיד/.test(u)) return { family: "u", amount: quantity };
  return null;
}

const NUM_OR_UNIT =
  /^(\d+([.,]\d+)?|ג|גר|גרם|גרמ|ק"ג|קג|ל|ליטר|מ"ל|מל|יח|יחידות|x|\*)$/;
function words(name: string): string[] {
  return name
    .replace(/(\d)([א-ת])/g, "$1 $2")
    .replace(/([א-ת])(\d)/g, "$1 $2")
    .split(/[\s,/+()-]+/)
    .filter((w) => w && !NUM_OR_UNIT.test(w));
}
const percents = (name: string) =>
  (name.match(/\d+(?:\.\d+)?%/g) ?? []).sort().join(",");

export type Candidate = {
  code: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  min_price: number;
  store_count: number;
};

/**
 * "The same kind of product, cheaper": same first word, same fat/alcohol percentage, similar size (±25%),
 * similar name (Jaccard ≥ 0.5 on the meaningful words), and a price per base unit at least 5% lower.
 */
export function cheaperAlternatives(
  target: Candidate,
  candidates: Candidate[],
  limit = 3,
): (Candidate & { saving: number })[] {
  const ts0 = normalizedSize(target.quantity, target.unit);
  const w0 = words(target.name);
  if (!ts0 || !w0.length || !target.min_price) return [];
  const per0 = target.min_price / ts0.amount;
  const set0 = new Set(w0);
  const out: (Candidate & { saving: number })[] = [];
  for (const c of candidates) {
    if (c.code === target.code || !c.min_price) continue;
    const s = normalizedSize(c.quantity, c.unit);
    if (
      !s ||
      s.family !== ts0.family ||
      s.amount < ts0.amount * 0.75 ||
      s.amount > ts0.amount * 1.25
    )
      continue;
    const w = words(c.name);
    if (
      !w.length ||
      w[0] !== w0[0] ||
      percents(c.name) !== percents(target.name)
    )
      continue;
    const set = new Set(w);
    const inter = [...set].filter((x) => set0.has(x)).length;
    if (inter / new Set([...set, ...set0]).size < 0.5) continue;
    const per = c.min_price / s.amount;
    if (per > per0 * 0.95) continue;
    out.push({ ...c, saving: 1 - per / per0 });
  }
  return out.sort((a, b) => b.saving - a.saving).slice(0, limit);
}
