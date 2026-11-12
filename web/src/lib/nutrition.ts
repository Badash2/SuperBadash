import { supabase } from "./supabase";
import type { ProductInfo } from "./types";

const inflight = new Map<string, Promise<ProductInfo | null>>();

/** The info version: older rows (without ingredients/processing) are re-fetched when the product card opens. */
export const INFO_VERSION = 2;

const num = (v: unknown): number | null =>
  typeof v === "number" && isFinite(v) ? v : null;

/** Nutrition values and image from Open Food Facts, cached in product_info for the whole family. */
export function fetchProductInfo(code: string): Promise<ProductInfo | null> {
  if (!/^\d{8,14}$/.test(code)) return Promise.resolve(null);
  if (inflight.has(code)) return inflight.get(code)!;
  const p = (async () => {
    try {
      const fields = [
        "product_name",
        "image_front_small_url",
        "nutriments",
        "nutriscore_grade",
        "nova_group",
        "ingredients_text_he",
        "ingredients_text",
        "ingredients_n",
        "additives_tags",
        "image_ingredients_url",
        "image_nutrition_url",
      ].join(",");
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${fields}`,
      );
      const j = res.ok ? await res.json() : null;
      const prod = j?.status === 1 ? j.product : null;
      const n = prod?.nutriments ?? {};
      const info: ProductInfo = {
        code,
        found: !!prod,
        off_name: prod?.product_name ?? null,
        image_url: prod?.image_front_small_url ?? null,
        kcal_100g: num(n["energy-kcal_100g"]),
        protein_100g: num(n["proteins_100g"]),
        sugar_100g: num(n["sugars_100g"]),
        fat_100g: num(n["fat_100g"]),
        sat_fat_100g: num(n["saturated-fat_100g"]),
        sodium_100g: num(n["sodium_100g"]),
        nutriscore:
          prod?.nutriscore_grade && prod.nutriscore_grade.length === 1
            ? prod.nutriscore_grade
            : null,
        carbs_100g: num(n["carbohydrates_100g"]),
        fiber_100g: num(n["fiber_100g"]),
        ingredients_text:
          prod?.ingredients_text_he || prod?.ingredients_text || null,
        ingredients_n: num(prod?.ingredients_n),
        additives: Array.isArray(prod?.additives_tags)
          ? (prod.additives_tags as string[]).map((a) =>
              a.replace(/^en:/, "").toUpperCase(),
            )
          : null,
        nova: num(prod?.nova_group),
        image_ingredients_url: prod?.image_ingredients_url ?? null,
        image_nutrition_url: prod?.image_nutrition_url ?? null,
        v: INFO_VERSION,
      };
      await supabase.from("product_info").upsert(info);
      return info;
    } catch {
      return null;
    }
  })();
  inflight.set(code, p);
  return p;
}

const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return isFinite(n) ? n : null;
};

/** A product_info row from the DB: numeric columns can arrive as strings - normalise to numbers. */
export function normalizeInfo(r: ProductInfo): ProductInfo {
  return {
    ...r,
    kcal_100g: toNum(r.kcal_100g),
    protein_100g: toNum(r.protein_100g),
    sugar_100g: toNum(r.sugar_100g),
    fat_100g: toNum(r.fat_100g),
    sat_fat_100g: toNum(r.sat_fat_100g),
    sodium_100g: toNum(r.sodium_100g),
    carbs_100g: toNum(r.carbs_100g),
    fiber_100g: toNum(r.fiber_100g),
    ingredients_n: toNum(r.ingredients_n),
    nova: toNum(r.nova),
  };
}

/** Protein per 100 kcal: the key measure for food that keeps you full and is healthy. */
export function proteinDensity(i: ProductInfo | undefined): number | null {
  if (!i || i.kcal_100g == null || i.protein_100g == null || i.kcal_100g <= 0)
    return null;
  return (i.protein_100g / i.kcal_100g) * 100;
}
