/**
 * Product health assessment: Ministry of Health red labels, protein ratio, calories, processing level.
 * Pure functions (scripts/test-health.mts). Each person tunes the thresholds in Settings (health_prefs).
 */

export type HealthPrefs = {
  kcal_high: number;
  protein_good: number; // g protein per 100 kcal
  processed_max_ingr: number;
  flag_additives: boolean;
  red_labels: boolean;
};
export const DEFAULT_HEALTH: HealthPrefs = {
  kcal_high: 400,
  protein_good: 10,
  processed_max_ingr: 8,
  flag_additives: true,
  red_labels: true,
};

export type Nutrition = {
  kcal?: number | null;
  protein?: number | null;
  fat?: number | null;
  sat_fat?: number | null;
  carbs?: number | null;
  sugars?: number | null;
  fiber?: number | null;
  sodium_mg?: number | null;
};

/**
 * Ministry of Health red labels (the current front-of-pack labelling regulations):
 * solids per 100g - sodium > 400 mg, sugars > 10 g, saturated fat > 4 g
 * liquids per 100ml - sodium > 300 mg, sugars > 5 g, saturated fat > 3 g
 */
const RED = {
  solid: { sodium_mg: 400, sugars: 10, sat_fat: 4 },
  liquid: { sodium_mg: 300, sugars: 5, sat_fat: 3 },
};
export type RedLabel = "sugars" | "sodium" | "sat_fat";
export const RED_LABEL_TEXT: Record<RedLabel, string> = {
  sugars: "סוכר בכמות גבוהה",
  sodium: "נתרן בכמות גבוהה",
  sat_fat: "שומן רווי בכמות גבוהה",
};

export function redLabels(n: Nutrition, liquid: boolean): RedLabel[] {
  const t = liquid ? RED.liquid : RED.solid;
  const out: RedLabel[] = [];
  if (n.sugars != null && n.sugars > t.sugars) out.push("sugars");
  if (n.sodium_mg != null && n.sodium_mg > t.sodium_mg) out.push("sodium");
  if (n.sat_fat != null && n.sat_fat > t.sat_fat) out.push("sat_fat");
  return out;
}

/** Grams of protein per 100 kcal (meaningful only above a minimal calorie count). */
export function proteinPer100kcal(n: Nutrition): number | null {
  if (n.kcal == null || n.protein == null || n.kcal < 20) return null;
  return (n.protein / n.kcal) * 100;
}

// ---------- ingredients and processing ----------

/** Additives typical of processed food: E numbers, and their Hebrew names on labels. */
const ADDITIVE_WORDS = [
  "מייצב",
  "מייצבים",
  "מתחלב",
  "מתחלבים",
  "חומר משמר",
  "חומרים משמרים",
  "חומרי שימור",
  "צבע מאכל",
  "צבעי מאכל",
  "ממתיק",
  "ממתיקים",
  "מעבה",
  "מעבים",
  "חומרי טעם וריח",
  "חומר טעם וריח",
  "מונוסודיום גלוטמט",
  "מגביר טעם",
  "מונע התגבשות",
  "חומר מונע",
  "סירופ גלוקוזה",
  "סירופ תירס",
  "שמן מוקשה",
  "עמילן מעובד",
  "אספרטיים",
  "סוכרלוז",
];
const E_NUMBER = /(?:^|[^a-z0-9])e[-\s]?(\d{3,4}[a-z]?)/gi;

/** Split an ingredient list into top-level ingredients (not inside brackets). */
export function splitIngredients(text: string): string[] {
  const body = text
    .replace(/^\s*רכיבים\s*:?/, "")
    .replace(/\s+/g, " ")
    .trim();
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === "،" || ch === ";") && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim().replace(/[.\s]+$/, ""));
  return out.filter((x) => x.length > 1 && !/^\d+%?$/.test(x));
}

export function findAdditives(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(E_NUMBER)) found.add(`E${m[1].toUpperCase()}`);
  for (const w of ADDITIVE_WORDS) if (text.includes(w)) found.add(w);
  return [...found];
}

export type Processing = "minimal" | "processed" | "ultra" | "unknown";
export const PROCESSING_TEXT: Record<Processing, string> = {
  minimal: "לא מעובד / מעובד מעט",
  processed: "מעובד",
  ultra: "מעובד מאוד",
  unknown: "רמת עיבוד לא ידועה",
};

/**
 * The processing level: by NOVA if available (1-2 minimal, 3 processed, 4 ultra);
 * otherwise from the ingredients: additives (if the person chose to count them) or many ingredients = ultra; 3+ = processed; up to 2 = minimal.
 */
export function processingLevel(
  p: {
    nova?: number | null;
    ingredients_n?: number | null;
    additives?: string[] | null;
    ingredients_text?: string | null;
  },
  prefs: HealthPrefs,
): { level: Processing; ingredients: number | null; additives: string[] } {
  const additives = p.additives?.length
    ? p.additives
    : p.ingredients_text
      ? findAdditives(p.ingredients_text)
      : [];
  const ingredients =
    p.ingredients_n ??
    (p.ingredients_text ? splitIngredients(p.ingredients_text).length : null);
  if (p.nova) {
    return {
      level: p.nova >= 4 ? "ultra" : p.nova === 3 ? "processed" : "minimal",
      ingredients,
      additives,
    };
  }
  if (ingredients == null) return { level: "unknown", ingredients, additives };
  if (
    (prefs.flag_additives && additives.length > 0) ||
    ingredients > prefs.processed_max_ingr
  ) {
    return { level: "ultra", ingredients, additives };
  }
  return {
    level: ingredients <= 2 ? "minimal" : "processed",
    ingredients,
    additives,
  };
}

export type Assessment = {
  red: RedLabel[];
  highKcal: boolean;
  proteinRatio: number | null;
  proteinGood: boolean;
  processing: ReturnType<typeof processingLevel>;
};

export function assess(
  n: Nutrition,
  p: Parameters<typeof processingLevel>[0],
  prefs: HealthPrefs,
  liquid: boolean,
): Assessment {
  const pr = proteinPer100kcal(n);
  return {
    red: prefs.red_labels ? redLabels(n, liquid) : [],
    highKcal: n.kcal != null && n.kcal > prefs.kcal_high,
    proteinRatio: pr,
    proteinGood: pr != null && pr >= prefs.protein_good,
    processing: processingLevel(p, prefs),
  };
}
