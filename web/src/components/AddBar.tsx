"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { SearchResult } from "@/lib/types";
import { ProductImage } from "./ProductImage";
import { ils } from "@/lib/pricing";
import { displayName } from "@/lib/text";
import { itemEmoji } from "@/lib/produce";

// Produce has no barcode - quick add with one tap
const QUICK_PRODUCE = [
  "עגבניות",
  "מלפפונים",
  "בננות",
  "תפוחים",
  "בצל",
  "תפוחי אדמה",
  "גזר",
  "פלפל אדום",
  "אבוקדו",
  "לימונים",
  "חסה",
  "פטרוזיליה",
  "שום",
  "בטטה",
  "קישואים",
  "תפוזים",
];

export type AddFn = (item: {
  code: string | null;
  name: string;
  weighted?: boolean; // a weighed product from the price files -> starts in kg
}) => Promise<void>;

/** Add to the list: search, barcode scan, or quick produce. */
export function AddBar({
  onAdd,
  onScan,
}: {
  onAdd: AddFn;
  onScan: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [showProduce, setShowProduce] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return; // the dropdown is hidden anyway below 2 characters
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const { data } = await supabase.rpc("search_products", {
        q: term,
        lim: 12,
      });
      if (my === seq.current) {
        setResults((data as SearchResult[]) ?? []);
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function add(code: string | null, name: string, weighted = false) {
    await onAdd({ code, name, weighted });
    setQ("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) add(null, q.trim());
          }}
          className="flex gap-2"
        >
          <div className="relative min-w-0 flex-1">
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder="מה צריך? חלב, במבה..."
              className="h-12 w-full rounded-2xl border border-line bg-surface pe-12 ps-4 text-base text-fg shadow-card outline-none placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
              enterKeyHint="done"
            />
            <button
              type="button"
              onClick={onScan}
              aria-label="סריקת ברקוד"
              title="סריקת ברקוד"
              className="absolute end-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-brand"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
                <path d="M7 8v8M10.5 8v8M14 8v8M17 8v8" />
              </svg>
            </button>
          </div>
          <button
            type="submit"
            className="h-12 rounded-2xl bg-brand px-5 font-bold text-brand-fg shadow-card active:bg-brand-strong disabled:opacity-40"
            disabled={!q.trim()}
          >
            הוסיפו
          </button>
        </form>

        {open && q.trim().length >= 2 && (
          <div className="absolute inset-x-0 top-full z-20 mt-2 max-h-[60vh] overflow-y-auto rounded-2xl border border-line bg-surface shadow-xl">
            {loading && results.length === 0 && (
              <div className="p-3 text-sm text-muted">מחפש...</div>
            )}
            {results.map((r) => (
              <button
                key={r.code}
                onClick={() => add(r.code, r.name, r.is_weighted)}
                className="flex w-full items-center gap-3 border-b border-line p-2.5 text-start last:border-0 hover:bg-surface-2"
              >
                <ProductImage code={r.barcode} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 font-medium leading-snug text-fg">
                    {displayName(r.name)}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {r.manufacturer ? `${r.manufacturer} · ` : ""}ב-
                    {r.store_count} סניפים
                  </div>
                </div>
                <div className="shrink-0 text-sm font-bold text-brand">
                  מ-{ils(r.min_price)}
                </div>
              </button>
            ))}
            {!loading && results.length === 0 && (
              <div className="p-3 text-sm text-muted">לא נמצא מוצר תואם</div>
            )}
            <button
              onClick={() => add(null, q.trim())}
              className="w-full p-3 text-start text-sm font-medium text-brand hover:bg-surface-2"
            >
              + הוסף &quot;{q.trim()}&quot; כטקסט חופשי
            </button>
          </div>
        )}
      </div>

      <div>
        <button
          onClick={() => setShowProduce((v) => !v)}
          className="text-sm font-medium text-brand"
        >
          🥬 ירקות ופירות בלחיצה {showProduce ? "▴" : "▾"}
        </button>
        {showProduce && (
          <div className="no-scrollbar -mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
            {QUICK_PRODUCE.map((p) => (
              <button
                key={p}
                onClick={() => onAdd({ code: null, name: p })}
                className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-fg shadow-card active:bg-brand-soft"
              >
                {itemEmoji(p)} {p}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
