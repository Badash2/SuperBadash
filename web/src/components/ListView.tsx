"use client";
import type { ListItem, Member, PriceRow, ProductInfo, Store } from "@/lib/types";
import { cheapest, effectivePrice, ils, isGoodDeal, type PriceMap } from "@/lib/pricing";
import { storeShort } from "@/lib/stores";
import { AddBar } from "./AddBar";
import { ProductImage } from "./ProductImage";
import { NutritionChip } from "./NutritionChip";

type Props = {
  items: ListItem[];
  prices: PriceMap;
  infos: Map<string, ProductInfo>;
  stores: Store[];
  members: Member[];
  currentStore: string;
  setCurrentStore: (s: string) => void;
  aisle: Map<string, number>;
  onAdd: (i: { code: string | null; name: string }) => Promise<void>;
  onToggle: (item: ListItem) => void;
  onQty: (item: ListItem, delta: number) => void;
  onDelete: (item: ListItem) => void;
  onFinish: () => void;
};

export function ListView(p: Props) {
  const who = (email: string) => {
    const m = p.members.find((x) => x.email.toLowerCase() === email.toLowerCase());
    return m?.display_name || email.split("@")[0];
  };
  const open = p.items.filter((i) => !i.checked);
  const done = p.items.filter((i) => i.checked).sort((a, b) => (a.checked_at ?? "").localeCompare(b.checked_at ?? ""));

  // In-store mode: sort by the aisle order learned from past trips; unknown items at the end
  const sorted = [...open].sort((a, b) => {
    if (p.currentStore) {
      const pa = p.aisle.get(a.code ?? a.name);
      const pb = p.aisle.get(b.code ?? b.name);
      if (pa != null || pb != null) return (pa ?? 2) - (pb ?? 2);
    }
    return a.added_at.localeCompare(b.added_at);
  });

  return (
    <div className="space-y-4">
      <AddBar onAdd={p.onAdd} />

      <label className="flex items-center gap-2 text-sm">
        <span className="text-slate-600 dark:text-slate-400">🛍 אני עכשיו ב:</span>
        <select
          value={p.currentStore}
          onChange={(e) => p.setCurrentStore(e.target.value)}
          className="flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="">לא בסופר (מתכנן)</option>
          {p.stores.map((s) => (
            <option key={s.store_key} value={s.store_key}>
              {storeShort(s.store_key, s.name)}
            </option>
          ))}
        </select>
      </label>
      {p.currentStore && p.aisle.size === 0 && (
        <p className="rounded-lg bg-sky-50 p-2 text-xs text-sky-800 dark:bg-sky-950 dark:text-sky-200">
          סמנו ✓ לפי הסדר שבו אתם אוספים מהמדפים. אחרי קנייה או שתיים הרשימה תסתדר לפי המסלול שלכם בסניף הזה.
        </p>
      )}

      {open.length === 0 && done.length === 0 && (
        <div className="py-12 text-center text-slate-500">הרשימה ריקה. מה חסר בבית? 🙂</div>
      )}

      <ul className="space-y-2">
        {sorted.map((it) => (
          <Row key={it.id} it={it} {...p} who={who} />
        ))}
      </ul>

      {done.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-500">בעגלה ({done.length})</h3>
            <button
              onClick={p.onFinish}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white active:bg-slate-900 dark:bg-slate-200 dark:text-slate-900"
            >
              ✅ סיימתי קנייה
            </button>
          </div>
          <ul className="space-y-2 opacity-60">
            {done.map((it) => (
              <Row key={it.id} it={it} {...p} who={who} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Row({ it, prices, infos, currentStore, onToggle, onQty, onDelete, who }: Props & { it: ListItem; who: (e: string) => string }) {
  const byStore = it.code ? prices.get(it.code) : undefined;
  const best = cheapest(byStore, it.quantity);
  const here: PriceRow | undefined = currentStore ? byStore?.get(currentStore) : undefined;
  const deals = byStore ? [...byStore.values()].filter(isGoodDeal) : [];
  const info = it.code ? infos.get(it.code) : undefined;

  return (
    <li className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900">
      <button
        onClick={() => onToggle(it)}
        aria-label={it.checked ? "בטל סימון" : "סמן כנלקח"}
        className={`mt-2.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-sm ${
          it.checked ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 dark:border-slate-600"
        }`}
      >
        {it.checked ? "✓" : ""}
      </button>
      <ProductImage code={it.code} fallbackUrl={info?.image_url} size={48} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start gap-2">
          <div className={`line-clamp-2 flex-1 font-medium leading-snug ${it.checked ? "line-through" : ""}`}>{it.name}</div>
          <button onClick={() => onDelete(it)} className="-mt-0.5 shrink-0 px-1 text-slate-400 hover:text-rose-600" aria-label="מחק">
            ✕
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
          {here ? (
            <span className="font-semibold text-slate-700 dark:text-slate-300">כאן: {ils(effectivePrice(here, it.quantity))}</span>
          ) : null}
          {best && (!here || best.store !== currentStore) && (
            <span className="whitespace-nowrap">
              הכי זול: <b className="text-emerald-700 dark:text-emerald-400">{ils(best.price)}</b> ב{storeShort(best.store)}
            </span>
          )}
          {it.code && !byStore && <span>אין מחיר כרגע</span>}
          {deals.length > 0 && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
              🔥 מבצע אמיתי ב{deals.map((d) => storeShort(d.store_key)).join(", ")}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <NutritionChip info={info} />
            <div className="text-[11px] text-slate-400">{who(it.checked && it.checked_by ? it.checked_by : it.added_by)}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={() => onQty(it, -1)} className="h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800" aria-label="פחות">
              −
            </button>
            <span className="w-6 text-center text-sm tabular-nums">{it.quantity}</span>
            <button onClick={() => onQty(it, 1)} className="h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800" aria-label="עוד">
              +
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
