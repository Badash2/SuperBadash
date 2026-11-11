"use client";
import type { ProductInfo } from "@/lib/types";
import { proteinDensity } from "@/lib/nutrition";

const NUTRI: Record<string, string> = {
  // The official Nutri-Score colours (a fixed meaning, so not from the theme)
  a: "bg-[#038141]", b: "bg-[#85bb2f]", c: "bg-[#fecb02] !text-[#1a1a1a]", d: "bg-[#ee8100]", e: "bg-[#e63e11]",
};

/** Compact nutrition: kcal and protein per 100g, protein per 100 kcal (colour = how "worth it" for protein). */
export function NutritionChip({ info }: { info?: ProductInfo }) {
  if (!info || !info.found || info.kcal_100g == null) return null;
  const pd = proteinDensity(info);
  const pdCls =
    pd == null ? "" : pd >= 10 ? "text-brand" : pd >= 5 ? "text-warn" : "text-muted";
  return (
    <span
      className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted"
      title="ערכים ל-100 גרם. חלבון/100 קל׳ = כמה חלבון מקבלים על כל 100 קלוריות"
    >
      {info.nutriscore && (
        <span className={`rounded px-1 font-bold uppercase text-white ${NUTRI[info.nutriscore] ?? "bg-faint"}`}>
          {info.nutriscore}
        </span>
      )}
      <span className="whitespace-nowrap">{Math.round(info.kcal_100g)} קל׳</span>
      {info.protein_100g != null && <span className="whitespace-nowrap">· {+info.protein_100g.toFixed(1)}ג׳ חלבון</span>}
      {pd != null && <span className={`whitespace-nowrap font-semibold ${pdCls}`}>· 💪 {pd.toFixed(1)}/100 קל׳</span>}
    </span>
  );
}
