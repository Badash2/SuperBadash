"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  buildSeries,
  cheaperAlternatives,
  insights,
  type Candidate,
  type Change,
} from "@/lib/history";
import { effectivePrice, ils, VERDICT } from "@/lib/pricing";
import { storeShort } from "@/lib/stores";
import { displayName } from "@/lib/text";
import type { PriceRow } from "@/lib/types";
import { ProductImage } from "./ProductImage";
import { PriceChart } from "./PriceChart";
import {
  HealthSection,
  NotesSection,
  ResearchSection,
  ReviewsSection,
  type Research,
} from "./ProductHealth";
import { DEFAULT_HEALTH, type HealthPrefs } from "@/lib/health";
import { fetchProductInfo, INFO_VERSION, normalizeInfo } from "@/lib/nutrition";
import { normalizedSize } from "@/lib/history";
import type { Member, ProductInfo } from "@/lib/types";

const RANGES: [number, string][] = [
  [30, "חודש"],
  [90, "3 חודשים"],
  [365, "שנה"],
];
const DAY = 86400000;

type Product = {
  code: string;
  barcode: string | null;
  name: string;
  manufacturer: string | null;
  quantity: number | null;
  unit: string | null;
};

/**
 * Product card: the answer in words first (cheapest now, what changed, the period low),
 * then the price-history chart, the price at each store, and cheaper alternatives of the same kind.
 */
export function ProductSheet({
  code,
  onClose,
  onAdd,
  onOpen,
  me,
  members,
}: {
  code: string;
  onClose: () => void;
  onAdd: (i: { code: string; name: string }) => void;
  onOpen: (code: string) => void;
  me: string;
  members: Member[];
}) {
  const [info, setInfo] = useState<ProductInfo | null>(null);
  const [research, setResearch] = useState<Research | null>(null);
  const [health, setHealth] = useState<HealthPrefs>(DEFAULT_HEALTH);
  const nameOf = (email: string) => {
    const m = members.find(
      (x) => x.email.toLowerCase() === email.toLowerCase(),
    );
    return m?.display_name || email.split("@")[0];
  };

  // Health: product info (re-fetched from Open Food Facts if the row is old), research results, personal thresholds
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [pi, rs, hp] = await Promise.all([
        supabase
          .from("product_info")
          .select("*")
          .eq("code", code)
          .maybeSingle(),
        supabase
          .from("product_research")
          .select("*")
          .eq("code", code)
          .maybeSingle(),
        supabase
          .from("health_prefs")
          .select("*")
          .ilike("email", me)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setResearch((rs.data as Research | null) ?? null);
      if (hp.data)
        setHealth({ ...DEFAULT_HEALTH, ...(hp.data as Partial<HealthPrefs>) });
      const row = pi.data ? normalizeInfo(pi.data as ProductInfo) : null;
      setInfo(row);
      if (!row || (row.v ?? 1) < INFO_VERSION) {
        const fresh = await fetchProductInfo(code);
        if (!cancelled && fresh) setInfo(fresh);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, me]);
  const [product, setProduct] = useState<Product | null>(null);
  const [history, setHistory] = useState<Change[] | null>(null);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [alts, setAlts] = useState<(Candidate & { saving: number })[] | null>(
    null,
  );
  const [days, setDays] = useState(30);
  const [focus, setFocus] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [added, setAdded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [p, h, pr] = await Promise.all([
        supabase
          .from("products")
          .select("code,barcode,name,manufacturer,quantity,unit")
          .eq("code", code)
          .maybeSingle(),
        supabase.rpc("product_history", { p_code: code, p_days: 365 }),
        supabase.rpc("prices_for", { codes: [code] }),
      ]);
      if (cancelled) return;
      const prod = p.data as Product | null;
      const rows = (pr.data as PriceRow[]) ?? [];
      setProduct(prod);
      setHistory((h.data as Change[]) ?? []);
      setPrices(rows);
      // Cheaper alternatives: candidates by the first word, then a strict filter (type, %, size, unit price)
      if (prod && rows.length) {
        const first = displayName(prod.name).split(/\s+/)[0];
        const { data: cands } = await supabase.rpc("search_products", {
          q: first,
          lim: 50,
        });
        if (cancelled) return;
        const target: Candidate = {
          ...prod,
          min_price: Math.min(...rows.map((r) => r.price)),
          store_count: rows.length,
        };
        setAlts(cheaperAlternatives(target, (cands as Candidate[]) ?? []));
      } else setAlts([]);
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const from = now - days * DAY;
  const series = useMemo(
    () => buildSeries(history ?? [], from, now),
    [history, from, now],
  );
  const byStore = useMemo(
    () => new Map(prices.map((r) => [r.store_key, r])),
    [prices],
  );
  const ranked = useMemo(
    () => [...prices].sort((a, b) => effectivePrice(a) - effectivePrice(b)),
    [prices],
  );
  const best = ranked[0];
  const focusStore = focus ?? best?.store_key ?? series[0]?.store ?? "";
  const facts = useMemo(
    () => insights(series, from, (k) => storeShort(k), ils),
    [series, from],
  );
  const firstSeen = history?.length
    ? Math.min(...history.map((c) => new Date(c.changed_at + "Z").getTime()))
    : null;
  const young = firstSeen != null && now - firstSeen < 14 * DAY;
  const changeOf = (store: string) => {
    const s = series.find((x) => x.store === store);
    if (!s) return null;
    const start = s.points[0]?.price;
    return start ? (s.current - start) / start : null;
  };

  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto bg-bg"
      role="dialog"
      aria-modal="true"
      aria-label="כרטיס מוצר"
    >
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-surface/95 px-2 py-2 backdrop-blur">
        <button
          onClick={onClose}
          className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-fg"
          aria-label="חזרה"
        >
          →
        </button>
        <h2 className="min-w-0 flex-1 truncate font-bold">
          {product ? displayName(product.name) : "טוען..."}
        </h2>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 pb-16 pt-4">
        {product && (
          <section className="flex items-center gap-4">
            <ProductImage code={product.barcode} size={84} />
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-lg font-bold leading-snug text-fg">
                {displayName(product.name)}
              </div>
              {product.manufacturer && (
                <div className="text-sm text-muted">{product.manufacturer}</div>
              )}
              <button
                onClick={() => {
                  onAdd({ code: product.code, name: product.name });
                  setAdded(true);
                }}
                disabled={added}
                className="mt-2 h-10 rounded-2xl bg-brand px-4 text-sm font-bold text-brand-fg shadow-card active:bg-brand-strong disabled:opacity-60"
              >
                {added ? "✓ נוסף לרשימה" : "+ לרשימה"}
              </button>
            </div>
          </section>
        )}

        {best && (
          <section className="space-y-2 rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="text-sm text-muted">הכי זול עכשיו</div>
            <div className="text-2xl font-extrabold tracking-tight text-fg">
              {ils(effectivePrice(best))}{" "}
              <span className="text-base font-bold">
                ב{storeShort(best.store_key)}
              </span>
            </div>
            {facts.length > 0 && (
              <ul className="space-y-1 text-sm">
                {facts.map((f) => (
                  <li key={f.text} className="flex items-start gap-2">
                    <span
                      className={`font-bold ${f.kind === "up" ? "text-warn" : f.kind === "down" || f.kind === "low" ? "text-brand" : "text-muted"}`}
                      aria-hidden="true"
                    >
                      {f.kind === "up"
                        ? "▲"
                        : f.kind === "down"
                          ? "▼"
                          : f.kind === "low"
                            ? "⬇"
                            : "↔"}
                    </span>
                    <span className="text-fg">{f.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <HealthSection
          info={info}
          research={research}
          prefs={health}
          liquid={
            normalizedSize(product?.quantity ?? null, product?.unit ?? null)
              ?.family === "ml"
          }
        />

        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold text-fg">היסטוריית מחיר</h3>
            <div className="flex gap-1" role="tablist" aria-label="טווח זמן">
              {RANGES.map(([d, label]) => (
                <button
                  key={d}
                  role="tab"
                  aria-selected={days === d}
                  onClick={() => setDays(d)}
                  className={`min-h-9 rounded-full px-3 text-xs font-medium ${days === d ? "bg-brand text-brand-fg" : "bg-surface-2 text-fg"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {young && (
            <p className="rounded-xl bg-info-soft p-2.5 text-xs text-info">
              המעקב אחרי המחירים התחיל ב-
              {new Date(firstSeen!).toLocaleDateString("he-IL")}. הקווים יתמלאו
              עם כל עדכון (3 פעמים ביום).
            </p>
          )}
          {history == null ? (
            <p className="text-sm text-muted">טוען...</p>
          ) : series.length ? (
            <PriceChart
              series={series}
              from={from}
              to={now}
              focus={focusStore}
            />
          ) : (
            <p className="text-sm text-muted">אין עדיין היסטוריה למוצר הזה.</p>
          )}

          {/* Legend + table: price per store; tap = highlight in the chart */}
          <ul className="divide-y divide-line">
            {ranked.map((r) => {
              const ch = changeOf(r.store_key);
              const active = r.store_key === focusStore;
              const promo =
                r.promo_unit_price != null &&
                r.promo_unit_price < r.price &&
                r.verdict
                  ? VERDICT[r.verdict]
                  : null;
              return (
                <li key={r.store_key}>
                  <button
                    onClick={() => setFocus(r.store_key)}
                    aria-pressed={active}
                    className="flex min-h-11 w-full items-center gap-3 py-2 text-start"
                  >
                    <span
                      className="h-1 w-4 shrink-0 rounded-full"
                      style={{
                        background: active ? "var(--brand)" : "var(--faint)",
                      }}
                      aria-hidden="true"
                    />
                    <span
                      className={`flex-1 text-sm ${active ? "font-bold text-fg" : "text-fg"}`}
                    >
                      {storeShort(r.store_key)}
                    </span>
                    {promo && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${promo.cls}`}
                      >
                        {ils(r.promo_unit_price!)} {promo.label}
                      </span>
                    )}
                    {ch != null && Math.abs(ch) >= 0.01 && (
                      <span
                        className={`text-xs font-semibold ${ch > 0 ? "text-warn" : "text-brand"}`}
                      >
                        {ch > 0 ? "▲" : "▼"}
                        <bdi dir="ltr">{Math.round(Math.abs(ch) * 100)}%</bdi>
                      </span>
                    )}
                    <span className="w-16 text-end text-sm font-bold tabular-nums text-fg">
                      {ils(r.price)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {alts && alts.length > 0 && (
          <section className="space-y-2">
            <h3 className="px-1 font-bold text-fg">
              💡 חלופות זולות יותר מאותו סוג
            </h3>
            {alts.map((a) => (
              <div
                key={a.code}
                className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card"
              >
                <button
                  onClick={() => onOpen(a.code)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-start"
                >
                  <ProductImage code={a.code} size={44} />
                  <div className="min-w-0">
                    <div className="line-clamp-2 font-semibold leading-snug text-fg">
                      {displayName(a.name)}
                    </div>
                    <div className="text-xs text-muted">
                      מ-{ils(a.min_price)} ·{" "}
                      <span className="font-semibold text-brand">
                        זול ב-{Math.round(a.saving * 100)}%
                      </span>{" "}
                      לפי משקל/נפח
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => onAdd({ code: a.code, name: a.name })}
                  className="h-10 shrink-0 rounded-2xl bg-surface-2 px-3 text-sm font-bold text-fg"
                >
                  + לרשימה
                </button>
              </div>
            ))}
          </section>
        )}
        <ReviewsSection research={research} />
        <NotesSection code={code} me={me} nameOf={nameOf} />
        <ResearchSection
          code={code}
          name={product?.name ?? code}
          research={research}
        />

        {byStore.size === 0 && history != null && (
          <p className="text-sm text-muted">
            אין כרגע מחיר למוצר הזה בסניפים שלנו.
          </p>
        )}
      </main>
    </div>
  );
}
