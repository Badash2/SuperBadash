import rules from "./category-rules.json";

export type SectionId = (typeof rules.sections)[number]["id"];
export type Section = { id: string; label: string; emoji: string };

export const SECTIONS: Section[] = rules.sections;
export const SECTION_BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));
export const DEFAULT_ORDER = new Map(SECTIONS.map((s, i) => [s.id, i]));

// Final letters -> regular, in the name and the patterns alike ("לימון" also catches "לימונים")
const FINALS: Record<string, string> = {
  ן: "נ",
  ם: "מ",
  ץ: "צ",
  ף: "פ",
  ך: "כ",
};
const unfinal = (x: string) => x.replace(/[ןםץףך]/g, (c) => FINALS[c]);

// Each pattern matches only at the start of a word (Hebrew has no \b in JS regex)
const COMPILED: [string, RegExp][] = rules.rules.map(([id, src]) => [
  id,
  new RegExp(`(?:^|[^\\u0590-\\u05FFa-zA-Z0-9])(?:${unfinal(src)})`),
]);

/** Flavour/scent descriptions mislead ("נודלס בטעם בקר" is not meat) - remove them before matching. */
const stripFlavour = (n: string) =>
  n.replace(/(?:בטעם|בניחוח|ניחוח|טעם)\s+\S+(?:\s+\S+)?/g, " ");

/** The section by product name. Measured: ~88% of popular products classified automatically. */
export function classify(name: string): string {
  const n = unfinal(stripFlavour(name));
  for (const [id, re] of COMPILED) if (re.test(n)) return id;
  return "other";
}

/** The key that a family override is stored under: the barcode/product code, or the free text. */
export const itemKey = (i: { code: string | null; name: string }) =>
  i.code ?? i.name.trim();
