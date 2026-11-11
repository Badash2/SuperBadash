"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { SearchResult } from "@/lib/types";
import { ProductImage } from "./ProductImage";
import { ils } from "@/lib/pricing";

/** Add to the list: search the products of all the stores, or free text. */
export function AddBar({ onAdd }: { onAdd: (item: { code: string | null; name: string }) => Promise<void> }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return; // the dropdown is hidden anyway below 2 characters
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const { data } = await supabase.rpc("search_products", { q: term, lim: 12 });
      if (my === seq.current) {
        setResults((data as SearchResult[]) ?? []);
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function add(code: string | null, name: string) {
    await onAdd({ code, name });
    setQ("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) add(null, q.trim());
        }}
        className="flex gap-2"
      >
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="מה צריך? (חלב, במבה, ברקוד...)"
          className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 dark:border-slate-700 dark:bg-slate-900"
          enterKeyHint="done"
        />
        <button
          type="submit"
          className="rounded-xl bg-emerald-600 px-4 font-semibold text-white active:bg-emerald-700 disabled:opacity-40"
          disabled={!q.trim()}
        >
          הוסף
        </button>
      </form>
      {open && q.trim().length >= 2 && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-[60vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {loading && results.length === 0 && <div className="p-3 text-sm text-slate-500">מחפש...</div>}
          {results.map((r) => (
            <button
              key={r.code}
              onClick={() => add(r.code, r.name)}
              className="flex w-full items-center gap-3 border-b border-slate-100 p-2 text-right last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
            >
              <ProductImage code={r.barcode} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.name}</div>
                <div className="text-xs text-slate-500">
                  {r.manufacturer || ""} · ב-{r.store_count} סניפים
                </div>
              </div>
              <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">מ-{ils(r.min_price)}</div>
            </button>
          ))}
          {!loading && results.length === 0 && <div className="p-3 text-sm text-slate-500">לא נמצא מוצר תואם</div>}
          <button
            onClick={() => add(null, q.trim())}
            className="w-full p-3 text-right text-sm text-emerald-700 hover:bg-slate-50 dark:text-emerald-400 dark:hover:bg-slate-800"
          >
            ➕ הוסף &quot;{q.trim()}&quot; כטקסט חופשי
          </button>
        </div>
      )}
    </div>
  );
}
