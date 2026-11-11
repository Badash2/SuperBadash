"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ils, VERDICT } from "@/lib/pricing";
import { storeShort } from "@/lib/stores";
import { ProductImage } from "./ProductImage";

type DealRow = {
  store_key: string;
  code: string;
  description: string | null;
  regular_price: number;
  promo_unit_price: number;
  min_qty: number | null;
  market_saving_pct: number;
  verdict: string;
  end_at: string | null;
  name?: string;
  barcode?: string | null;
};

/** Real deals: first on products you actually buy, then the best in the area. */
export function DealsView({ myCodes, onAdd }: { myCodes: string[]; onAdd: (i: { code: string; name: string }) => void }) {
  const [mine, setMine] = useState<DealRow[] | null>(null);
  const [top, setTop] = useState<DealRow[] | null>(null);
  const [now] = useState(() => Date.now());
  const codesKey = myCodes.join(",");

  useEffect(() => {
    let cancelled = false;
    async function withNames(rows: DealRow[]): Promise<DealRow[]> {
      const codes = [...new Set(rows.map((r) => r.code))];
      if (codes.length === 0) return rows;
      const { data } = await supabase.from("products").select("code,name,barcode").in("code", codes);
      const m = new Map((data ?? []).map((p) => [p.code as string, p]));
      return rows.map((r) => ({ ...r, name: m.get(r.code)?.name, barcode: m.get(r.code)?.barcode }));
    }
    (async () => {
      const cols = "store_key,code,description,regular_price,promo_unit_price,min_qty,market_saving_pct,verdict,end_at";
      const codes = codesKey ? codesKey.split(",") : [];
      const [a, b] = await Promise.all([
        codes.length
          ? supabase.from("deals").select(cols).in("code", codes).in("verdict", ["real", "conditional", "fake"])
          : Promise.resolve({ data: [] }),
        supabase.from("deals").select(cols).eq("verdict", "real").gte("market_saving_pct", 15).lte("market_saving_pct", 70)
          .order("market_saving_pct", { ascending: false }).limit(60),
      ]);
      const [m, t] = await Promise.all([withNames((a.data as DealRow[]) ?? []), withNames((b.data as DealRow[]) ?? [])]);
      if (!cancelled) {
        setMine(m.sort((x, y) => y.market_saving_pct - x.market_saving_pct));
        setTop(t);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [codesKey]);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="font-semibold">🎯 על מה שאתם קונים</h3>
        {mine == null ? (
          <p className="text-sm text-slate-500">טוען...</p>
        ) : mine.length === 0 ? (
          <p className="text-sm text-slate-500">
            אין כרגע מבצעים על מוצרים מהרשימה ומהקניות הקודמות. ככל שתשתמשו יותר, הלשונית הזו תהיה חכמה יותר.
          </p>
        ) : (
          mine.map((d) => <DealCard key={d.store_key + d.code} d={d} now={now} onAdd={onAdd} />)
        )}
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">🔥 המבצעים האמיתיים הכי טובים באזור</h3>
        <p className="text-xs text-slate-500">
          רק מבצעים שנבדקו: זולים באמת מול שאר הסניפים, פתוחים לכולם, ולא &quot;קבועים&quot;.
        </p>
        {top == null ? <p className="text-sm text-slate-500">טוען...</p> : top.map((d) => <DealCard key={d.store_key + d.code} d={d} now={now} onAdd={onAdd} />)}
      </section>
    </div>
  );
}

function DealCard({ d, now, onAdd }: { d: DealRow; now: number; onAdd: (i: { code: string; name: string }) => void }) {
  const v = VERDICT[d.verdict] ?? VERDICT.meh;
  const end = d.end_at ? new Date(d.end_at) : null;
  const daysLeft = end ? Math.ceil((end.getTime() - now) / 86400000) : null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
      <ProductImage code={d.barcode ?? null} size={44} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{d.name ?? d.code}</div>
        <div className="truncate text-xs text-slate-500">{d.description}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded px-1.5 py-0.5 font-semibold ${v.cls}`}>{v.label}</span>
          <span>{storeShort(d.store_key)}</span>
          <span>
            <s className="text-slate-400">{ils(d.regular_price)}</s> <b>{ils(d.promo_unit_price)}</b>
            {d.min_qty && d.min_qty > 1 ? ` (בקניית ${d.min_qty})` : ""}
          </span>
          <span className="text-emerald-700 dark:text-emerald-400">−{Math.round(d.market_saving_pct)}% מול השוק</span>
          {daysLeft != null && daysLeft <= 7 && daysLeft >= 0 && <span className="text-amber-700">נגמר בעוד {daysLeft} ימים</span>}
        </div>
      </div>
      <button
        onClick={() => onAdd({ code: d.code, name: d.name ?? d.code })}
        className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-sm font-semibold text-white"
        aria-label="הוסף לרשימה"
      >
        +
      </button>
    </div>
  );
}
