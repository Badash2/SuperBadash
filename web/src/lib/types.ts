export type Store = { store_key: string; name: string; chain: string };

export type ListItem = {
  id: string;
  code: string | null;
  name: string;
  quantity: number;
  unit: "units" | "kg";
  note: string | null;
  added_by: string;
  added_at: string;
  checked: boolean;
  checked_at: string | null;
  checked_by: string | null;
  checked_store: string | null;
};

export type SearchResult = {
  code: string;
  barcode: string | null;
  name: string;
  manufacturer: string | null;
  quantity: number | null;
  unit: string | null;
  is_weighted: boolean;
  min_price: number;
  store_count: number;
};

export type PriceRow = {
  code: string;
  store_key: string;
  price: number;
  promo_unit_price: number | null;
  verdict: string | null;
  promo_description: string | null;
  min_qty: number | null;
  flags: string | null;
  end_at: string | null;
};

export type ProductInfo = {
  code: string;
  found: boolean;
  off_name: string | null;
  image_url: string | null;
  kcal_100g: number | null;
  protein_100g: number | null;
  sugar_100g: number | null;
  fat_100g: number | null;
  sat_fat_100g: number | null;
  sodium_100g: number | null;
  nutriscore: string | null;
  // v2: ingredients and processing (Open Food Facts), carbohydrates, fibre, back-of-pack images
  carbs_100g?: number | null;
  fiber_100g?: number | null;
  ingredients_text?: string | null;
  ingredients_n?: number | null;
  additives?: string[] | null;
  nova?: number | null;
  image_ingredients_url?: string | null;
  image_nutrition_url?: string | null;
  v?: number;
};

/** A family member. is_device = an approved account that isn't a person (the bin scanner): excluded from people lists. */
export type Member = {
  email: string;
  display_name: string | null;
  is_device?: boolean;
};
export const isPerson = (m: { is_device?: boolean | null }) =>
  m.is_device !== true;
