"use client";
import type { ListItem, Store } from "@/lib/types";
import { effectivePrice, ils, type PriceMap } from "@/lib/pricing";
import { storeColor, storeShort } from "@/lib/stores";

const SPLIT_WORTH_IT = 25; // ₪ - below this, a second stop isn't worth it

type StoreTotal = { store: string; total: number; missing: ListItem[] };

export function CompareView({
  items,
  prices,
  stores,
}: {
  items: ListItem[];
  prices: PriceMap;
  stores: Store[];
}) {
  const open = items.filter((i) => !i.checked);
  const priced = open.filter((i) => i.code && prices.has(i.code));
  const unpriced = open.filter((i) => !i.code || !prices.has(i.code));

  if (priced.length === 0) {
    return (
      <div className="py-12 text-center text-muted">
        כדי להשוות, הוסיפו לרשימה מוצרים מתוך החיפוש או בסריקה.
      </div>
    );
  }

  const keys = stores.map((s) => s.store_key);
  const unit = (it: ListItem, s: string) => {
    const r = prices.get(it.code!)?.get(s);
    return r ? effectivePrice(r, it.quantity) * it.quantity : null;
  };

  const totals: StoreTotal[] = keys
    .map((s) => {
      let total = 0;
      const missing: ListItem[] = [];
      for (const it of priced) {
        const c = unit(it, s);
        if (c == null) missing.push(it);
        else total += c;
      }
      return { store: s, total, missing };
    })
    .sort((a, b) => a.missing.length - b.missing.length || a.total - b.total);

  const bestSingle = totals[0];

  // The best split across two stores (each item at the cheaper of the two)
  let bestPair: {
    a: string;
    b: string;
    total: number;
    assign: Map<string, string>;
  } | null = null;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      let total = 0;
      let missing = 0;
      const assign = new Map<string, string>();
      for (const it of priced) {
        const ca = unit(it, keys[i]);
        const cb = unit(it, keys[j]);
        if (ca == null && cb == null) {
          missing++;
          continue;
        }
        if (cb == null || (ca != null && ca <= cb)) {
          total += ca!;
          assign.set(it.id, keys[i]);
        } else {
          total += cb;
          assign.set(it.id, keys[j]);
        }
      }
      if (missing > bestSingle.missing.length) continue;
      if (!bestPair || total < bestPair.total)
        bestPair = { a: keys[i], b: keys[j], total, assign };
    }
  }
  const pairSaving = bestPair ? bestSingle.total - bestPair.total : 0;
  const maxTotal = Math.max(...totals.map((t) => t.total));

  return (
    <div className="space-y-5">
      <section className="rounded-xl bg-brand-soft p-4">
        <div className="text-sm text-brand">הכי משתלם לסל הזה</div>
        <div className="text-2xl font-bold">
          {storeShort(bestSingle.store)} · {ils(bestSingle.total)}
        </div>
        {bestSingle.missing.length > 0 && (
          <div className="text-xs text-warn">
            חסרים שם: {bestSingle.missing.map((m) => m.name).join(", ")}
          </div>
        )}
        {bestPair && pairSaving >= SPLIT_WORTH_IT && (
          <div className="mt-2 text-sm">
            💡 חלוקה בין <b>{storeShort(bestPair.a)}</b> ל
            <b>{storeShort(bestPair.b)}</b> חוסכת עוד <b>{ils(pairSaving)}</b>{" "}
            (ראו פירוט למטה)
          </div>
        )}
        {bestPair && pairSaving > 0 && pairSaving < SPLIT_WORTH_IT && (
          <div className="mt-1 text-xs text-muted">
            חלוקה לשני סופרים הייתה חוסכת רק {ils(pairSaving)}, לא שווה נסיעה
            נוספת.
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-muted">
          כל הסניפים ({priced.length} מוצרים)
        </h3>
        {totals.map((t) => (
          <div key={t.store} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: storeColor(t.store) }}
                />
                {storeShort(t.store)}
              </span>
              <span className="tabular-nums">
                {t.missing.length > 0 ? (
                  <span className="text-xs text-warn">
                    {ils(t.total)} · בלי {t.missing.length} מוצרים
                  </span>
                ) : (
                  ils(t.total)
                )}
              </span>
            </div>
            <div className="h-2 rounded-full bg-surface-2">
              {/* An incomplete basket isn't comparable - a grey bar so it doesn't look "cheap" */}
              <div
                className={`h-2 rounded-full ${t.missing.length > 0 ? "bg-faint/40" : t.store === bestSingle.store ? "bg-brand" : "bg-muted/50"}`}
                style={{
                  width: `${maxTotal ? (t.total / maxTotal) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        ))}
      </section>

      {bestPair && pairSaving >= SPLIT_WORTH_IT && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-muted">חלוקה מומלצת</h3>
          {[bestPair.a, bestPair.b].map((s) => (
            <div
              key={s}
              className="rounded-2xl border border-line bg-surface p-3 shadow-card"
            >
              <div className="mb-1 flex items-center gap-2 font-semibold text-fg">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: storeColor(s) }}
                />
                {storeShort(s)}
              </div>
              <ul className="text-sm text-muted">
                {priced
                  .filter((it) => bestPair!.assign.get(it.id) === s)
                  .map((it) => (
                    <li key={it.id}>• {it.name}</li>
                  ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {unpriced.length > 0 && (
        <p className="text-xs text-muted">
          לא נכללו בהשוואה (מוצרים בלי ברקוד או בלי מחיר):{" "}
          {unpriced.map((u) => u.name).join(", ")}
        </p>
      )}
    </div>
  );
}
