/**
 * Item symbol + default sale unit.
 * Produce is sold in Israel mostly by weight (kg); some is sold by the unit (lettuce, cauliflower, a bunch of parsley...).
 * The first matching rule wins - more specific items above general ones ("פלפל חריף" before "פלפל").
 */
export type Unit = "units" | "kg";

const RULES: [RegExp, string, Unit][] = [
  // -- by the unit --
  [/חס[הת]/, "🥬", "units"],
  [/כרובית/, "🥦", "units"],
  [/ברוקולי/, "🥦", "units"],
  [/כרוב/, "🥬", "units"],
  [/אבטיח/, "🍉", "units"],
  [/מלון/, "🍈", "units"],
  [/אננס/, "🍍", "units"],
  [/פטרוזיליה|כוסברה|שמיר|נענע|בזיליקום|עשבי/, "🌿", "units"],
  [/שום/, "🧄", "units"],
  [/תירס/, "🌽", "units"],
  [/קוקוס/, "🥥", "units"],
  [/אוכמניות|פטל/, "🫐", "units"],
  // -- by weight --
  [/עגבני|שרי/, "🍅", "kg"],
  [/מלפפון/, "🥒", "kg"],
  [/קישוא/, "🥒", "kg"],
  [/בננ/, "🍌", "kg"],
  [/תפוחי? אדמה|תפו"א|תפוא/, "🥔", "kg"],
  [/בטטה|בטטות/, "🍠", "kg"],
  [/תפוח|תפוחים/, "🍎", "kg"],
  [/אגס/, "🍐", "kg"],
  [/בצל/, "🧅", "kg"],
  [/גזר/, "🥕", "kg"],
  [/פלפל חריף|צ'ילי/, "🌶️", "kg"],
  [/פלפל/, "🫑", "kg"],
  [/אבוקדו/, "🥑", "kg"],
  [/לימון|ליים/, "🍋", "kg"],
  [/תפוז|קלמנטינ|מנדרינ|אשכולית|פומלה/, "🍊", "kg"],
  [/ענב/, "🍇", "kg"],
  [/תות/, "🍓", "kg"],
  [/דובדבנ/, "🍒", "kg"],
  [/אפרסק|נקטרינ|משמש/, "🍑", "kg"],
  [/מנגו/, "🥭", "kg"],
  [/קיווי/, "🥝", "kg"],
  [/חציל/, "🍆", "kg"],
  [/פטרי/, "🍄", "kg"],
  [/ג'ינג'ר|זנגביל/, "🫚", "kg"],
  [/סלק|צנון|קולרבי|דלעת|שומר/, "🥬", "kg"],
  [/שזיפ|תאנ|רימונ|אפרסמון/, "🍑", "kg"],
  // -- common basic items typed as free text (by the unit) --
  [/ביצים|ביצה/, "🥚", "units"],
  [/^חלב|חלב /, "🥛", "units"],
  [/לחם|לחמני|פית/, "🍞", "units"],
  [/גבינ|קוטג/, "🧀", "units"],
  [/עוף|חזה|שניצל/, "🍗", "kg"],
  [/בשר|טחון|סטייק/, "🥩", "kg"],
  [/דג|סלמון/, "🐟", "kg"],
  [/קפה/, "☕", "units"],
  [/מים|סודה/, "💧", "units"],
  [/יין/, "🍷", "units"],
];

/** Final letters -> regular ("מלפפון" and "מלפפונים" share one pattern). Applied to the name and the patterns alike. */
const FINALS: Record<string, string> = {
  ן: "נ",
  ם: "מ",
  ץ: "צ",
  ף: "פ",
  ך: "כ",
};
const unfinal = (s: string) => s.replace(/[ןםץףך]/g, (c) => FINALS[c]);
const COMPILED = RULES.map(
  ([re, emoji, unit]) => [new RegExp(unfinal(re.source)), emoji, unit] as const,
);

function rule(name: string) {
  const n = unfinal(name.trim());
  return COMPILED.find(([re]) => re.test(n));
}

/** The item's own symbol, or null (then the section's symbol is used). */
export function itemEmoji(name: string): string | null {
  return rule(name)?.[1] ?? null;
}

/**
 * The unit when adding:
 *  - a product from the price files that is weighed (bIsWeighted) -> kg
 *  - a packaged product with a barcode -> units
 *  - free text -> by the dictionary (most produce in kg), otherwise units
 */
export function defaultUnit(
  name: string,
  opts: { code?: string | null; weighted?: boolean } = {},
): Unit {
  if (opts.weighted) return "kg";
  if (opts.code) return "units";
  return rule(name)?.[2] ?? "units";
}

export const UNIT_STEP: Record<Unit, number> = { units: 1, kg: 0.5 };
export const UNIT_LABEL: Record<Unit, string> = { units: "יח׳", kg: "ק״ג" };

/** Quantity + unit for display: "1.5 ק״ג", "6 יח׳". */
export function formatQty(q: number, unit: Unit): string {
  const n =
    unit === "kg" ? String(Math.round(q * 10) / 10) : String(Math.round(q));
  return `${n} ${UNIT_LABEL[unit]}`;
}

/** Change the quantity by one step: units step 1 (min 1), kg step half a kilo (min half). */
export function stepQty(q: number, unit: Unit, dir: 1 | -1): number {
  const step = UNIT_STEP[unit];
  return Math.max(step, Math.round((q + dir * step) * 10) / 10);
}

/** Switching units: kg -> units = at least 1 whole; units -> kg = start from 1 kg. */
export function switchUnit(
  q: number,
  from: Unit,
): { quantity: number; unit: Unit } {
  return from === "kg"
    ? { unit: "units", quantity: Math.max(1, Math.round(q)) }
    : { unit: "kg", quantity: 1 };
}
