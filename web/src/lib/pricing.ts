import type { PriceRow } from "./types";

/**
 * What you will actually pay per unit at a store for `qty` units.
 * - A promo counts only if it is open to everyone (not coupon/club = "conditional")
 *   and the quantity reaches the minimum ("3 for 10" doesn't help if you buy one).
 * - A "fake" promo (price raised beforehand) still lowers the price you pay; it just isn't a real deal.
 */
export function effectivePrice(r: PriceRow, qty = 1): number {
  if (r.promo_unit_price == null || r.verdict === "conditional") return r.price;
  const minQ = r.min_qty ?? 1;
  if (minQ >= 1 && qty < minQ) return r.price;
  return Math.min(r.price, r.promo_unit_price);
}

export function isGoodDeal(r: PriceRow): boolean {
  return (
    r.verdict === "real" &&
    r.promo_unit_price != null &&
    r.promo_unit_price < r.price
  );
}

export const VERDICT: Record<string, { label: string; cls: string }> = {
  real: { label: "מבצע אמיתי", cls: "bg-accent-soft text-accent" },
  conditional: { label: "מבצע מותנה", cls: "bg-warn-soft text-warn" },
  permanent: { label: "מבצע קבוע", cls: "bg-surface-2 text-muted" },
  meh: { label: "מבצע", cls: "bg-info-soft text-info" },
  fake: { label: "מבצע מזויף", cls: "bg-danger/15 text-danger" },
};

export const ils = (n: number) => `₪${n.toFixed(2)}`;

export type PriceMap = Map<string, Map<string, PriceRow>>; // code -> store -> row

export function toPriceMap(rows: PriceRow[]): PriceMap {
  const m: PriceMap = new Map();
  for (const r of rows) {
    if (!m.has(r.code)) m.set(r.code, new Map());
    m.get(r.code)!.set(r.store_key, r);
  }
  return m;
}

export function cheapest(
  byStore: Map<string, PriceRow> | undefined,
  qty = 1,
): { store: string; price: number } | null {
  if (!byStore) return null;
  let best: { store: string; price: number } | null = null;
  for (const [store, r] of byStore) {
    const p = effectivePrice(r, qty);
    if (!best || p < best.price) best = { store, price: p };
  }
  return best;
}
