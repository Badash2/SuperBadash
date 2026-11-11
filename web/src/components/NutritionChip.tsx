"use client";
import type { ProductInfo } from "@/lib/types";
import { proteinDensity } from "@/lib/nutrition";

const NUTRI: Record<string, string> = {
  a: "bg-emerald-600", b: "bg-lime-500", c: "bg-yellow-400 text-slate-900", d: "bg-orange-500", e: "bg-rose-600",
};

/** Compact nutrition: kcal and protein per 100g, protein per 100 kcal (colour = how "worth it" for protein). */
export function NutritionChip({ info }: { info?: ProductInfo }) {
  if (!info || !info.found || info.kcal_100g == null) return null;
  const pd = proteinDensity(info);
  const pdCls =
    pd == null ? "" : pd >= 10 ? "text-emerald-700 dark:text-emerald-400" : pd >= 5 ? "text-amber-700 dark:text-amber-400" : "text-slate-500";
  return (
    <span
      className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-500 dark:text-slate-400"
      title="ערכים ל-100 גרם. חלבון/100 קל׳ = כמה חלבון מקבלים על כל 100 קלוריות"
    >
      {info.nutriscore && (
        <span className={`rounded px-1 font-bold uppercase text-white ${NUTRI[info.nutriscore] ?? "bg-slate-400"}`}>
          {info.nutriscore}
        </span>
      )}
      <span className="whitespace-nowrap">{Math.round(info.kcal_100g)} קל׳</span>
      {info.protein_100g != null && <span className="whitespace-nowrap">· {+info.protein_100g.toFixed(1)}ג׳ חלבון</span>}
      {pd != null && <span className={`whitespace-nowrap font-semibold ${pdCls}`}>· 💪 {pd.toFixed(1)}/100 קל׳</span>}
    </span>
  );
}
