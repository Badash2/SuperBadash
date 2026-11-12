/**
 * Notification rules: who gets what and when. Pure functions (no DB/network) - tested in scripts/test-notify-rules.ts.
 * Everything is personal: each family member sets in Settings what interests them.
 */

export type Prefs = {
  email: string;
  list_adds: "off" | "in_store" | "always";
  ran_out: "off" | "daily" | "each";
  ran_out_from: string[] | null; // null = everyone; emails and/or "kiosk"
  deals: "off" | "daily" | "each";
  deals_scope: "ours" | "ours_plus_top";
  digest_hour: number;
  quiet: boolean;
};

export const DEFAULT_PREFS: Omit<Prefs, "email"> = {
  list_adds: "in_store",
  ran_out: "daily",
  ran_out_from: null,
  deals: "daily",
  deals_scope: "ours",
  digest_hour: 19,
  quiet: true,
};

export const KIOSK_SOURCE = "kiosk";
const IN_STORE_TTL_MS = 3 * 3600 * 1000; // "I'm in the store" expires on its own after 3 hours

export function prefsFor(email: string, rows: Prefs[]): Prefs {
  const r = rows.find((p) => p.email.toLowerCase() === email.toLowerCase());
  return r ?? { email, ...DEFAULT_PREFS };
}

/** The hour and date in Israel (handles daylight saving time). */
export function israelClock(now: Date): { hour: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    hour: Number(get("hour")) % 24,
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

export function isQuietHour(now: Date): boolean {
  const { hour } = israelClock(now);
  return hour >= 22 || hour < 7;
}

/** Item added to the list -> who should hear about it (never the one who added it). */
export function listAddRecipients(
  members: string[],
  prefs: Prefs[],
  status: { email: string; current_store: string | null; updated_at: string }[],
  actor: string,
  now: Date,
): string[] {
  return members.filter((m) => {
    if (m.toLowerCase() === actor.toLowerCase()) return false;
    const p = prefsFor(m, prefs);
    if (p.list_adds === "off") return false;
    if (p.list_adds === "always") return true;
    const s = status.find((x) => x.email.toLowerCase() === m.toLowerCase());
    return (
      !!s?.current_store &&
      now.getTime() - new Date(s.updated_at).getTime() < IN_STORE_TTL_MS
    );
  });
}

/** Does the scan's source pass the user's filter ("only when Odelia scans"). */
export function ranOutSourceAllowed(
  p: Prefs,
  scannedAs: string | null,
): boolean {
  if (!p.ran_out_from || p.ran_out_from.length === 0) return true;
  const src = (scannedAs ?? KIOSK_SOURCE).toLowerCase();
  return p.ran_out_from.some((s) => s.toLowerCase() === src);
}

/** A product scanned at the bin -> who gets an immediate notification ("each" only, outside quiet hours). */
export function ranOutEachRecipients(
  members: string[],
  prefs: Prefs[],
  scannedAs: string | null,
  now: Date,
): string[] {
  return members.filter((m) => {
    const p = prefsFor(m, prefs);
    if (p.ran_out !== "each" || !ranOutSourceAllowed(p, scannedAs))
      return false;
    return !(p.quiet && isQuietHour(now));
  });
}

/** Is it this user's daily-digest hour now. */
export function isDigestHour(p: Prefs, now: Date): boolean {
  return israelClock(now).hour === p.digest_hour;
}

export type DealLite = {
  store_key: string;
  code: string;
  promo_id: string | null;
  verdict: string;
  market_saving_pct: number;
  promo_unit_price: number;
  regular_price: number;
  description: string | null;
};

/**
 * Which deals are relevant to the family: real deals on "our products" (bought / on the list / ran out),
 * ordered by how often we buy the product, then by size of saving. With "ours_plus_top", a few strong general deals are added.
 */
export function relevantDeals(
  deals: DealLite[],
  ourCodes: Map<string, number>, // code -> weight (how many times bought/ran out)
  scope: Prefs["deals_scope"],
  topExtra = 3,
): DealLite[] {
  const real = deals.filter((d) => d.verdict === "real");
  const ours = real
    .filter((d) => ourCodes.has(d.code))
    .sort(
      (a, b) =>
        (ourCodes.get(b.code) ?? 0) - (ourCodes.get(a.code) ?? 0) ||
        b.market_saving_pct - a.market_saving_pct,
    );
  // One deal per product (the cheapest store)
  const seen = new Set<string>();
  const out: DealLite[] = [];
  for (const d of ours) {
    if (seen.has(d.code)) continue;
    seen.add(d.code);
    out.push(d);
  }
  if (scope === "ours_plus_top") {
    const extra = real
      .filter(
        (d) =>
          !ourCodes.has(d.code) &&
          d.market_saving_pct >= 25 &&
          d.market_saving_pct <= 70,
      )
      .sort((a, b) => b.market_saving_pct - a.market_saving_pct)
      .slice(0, topExtra);
    out.push(...extra);
  }
  return out;
}

export function dealRef(d: DealLite): string {
  return `${d.store_key}:${d.code}:${d.promo_id ?? ""}`;
}
