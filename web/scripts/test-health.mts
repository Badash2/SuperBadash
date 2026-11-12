// Tests for the health assessment. Run: npm test
import assert from "node:assert/strict";
import { assess, DEFAULT_HEALTH, findAdditives, processingLevel, proteinPer100kcal, redLabels, splitIngredients } from "../src/lib/health.ts";

let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("✓", name);
};

t("red labels: solid vs liquid thresholds (Ministry of Health)", () => {
  // Bamba: sodium 380mg - below 400 -> no; a sugary cereal: sugar 25 -> yes
  assert.deepEqual(redLabels({ sodium_mg: 380, sugars: 2, sat_fat: 3 }, false), []);
  assert.deepEqual(redLabels({ sugars: 25 }, false), ["sugars"]);
  // cola: 10.6g sugar per 100ml -> liquid threshold 5 -> red
  assert.deepEqual(redLabels({ sugars: 10.6 }, true), ["sugars"]);
  assert.deepEqual(redLabels({ sugars: 8 }, false), []); // as a solid it would be fine
  assert.deepEqual(redLabels({ sodium_mg: 1200, sat_fat: 18 }, false), ["sodium", "sat_fat"]);
});

t("protein ratio: cottage cheese is protein-rich, Bamba isn't", () => {
  assert.equal(Math.round(proteinPer100kcal({ kcal: 97, protein: 10.2 })!), 11);
  assert.equal(Math.round(proteinPer100kcal({ kcal: 535, protein: 17 })! * 10) / 10, 3.2);
  assert.equal(proteinPer100kcal({ kcal: 5, protein: 0 }), null); // water/diet drink - meaningless
});

t("splitting ingredients - brackets don't split", () => {
  const bamba = "רכיבים: בוטנים טחונים (50%), גריסי תירס, שמנים מהצומח, מלח, ויטמינים (ויטמין C, ויטמין B3, ויטמין E), ברזל.";
  assert.deepEqual(splitIngredients(bamba), ["בוטנים טחונים (50%)", "גריסי תירס", "שמנים מהצומח", "מלח", "ויטמינים (ויטמין C, ויטמין B3, ויטמין E)", "ברזל"]);
});

t("additives: E numbers and Hebrew names", () => {
  assert.deepEqual(findAdditives("סוכר, מייצב (E-412), צבע מאכל E150d, חומרי טעם וריח").sort(), ["E150D", "E412", "חומרי טעם וריח", "מייצב", "צבע מאכל"].sort());
  assert.deepEqual(findAdditives("חלב, מלח"), []);
});

t("processing: NOVA first; otherwise ingredients + additives per the thresholds", () => {
  const P = DEFAULT_HEALTH;
  assert.equal(processingLevel({ nova: 4 }, P).level, "ultra");
  assert.equal(processingLevel({ ingredients_text: "חלב פרה" }, P).level, "minimal");
  assert.equal(processingLevel({ ingredients_text: "קמח, מים, שמרים, מלח" }, P).level, "processed");
  assert.equal(processingLevel({ ingredients_text: "קמח, סוכר, מייצב E412" }, P).level, "ultra");
  assert.equal(processingLevel({ ingredients_text: "קמח, סוכר, מייצב E412" }, { ...P, flag_additives: false }).level, "processed");
  assert.equal(processingLevel({}, P).level, "unknown");
});

t("full assessment with personal thresholds", () => {
  const a = assess({ kcal: 535, protein: 17, sugars: 3, sodium_mg: 380, sat_fat: 3 }, { ingredients_n: 6 }, DEFAULT_HEALTH, false);
  assert.equal(a.highKcal, true);
  assert.equal(a.proteinGood, false);
  assert.deepEqual(a.red, []);
  const b = assess({ kcal: 535, protein: 17 }, {}, { ...DEFAULT_HEALTH, kcal_high: 600, protein_good: 3 }, false);
  assert.equal(b.highKcal, false);
  assert.equal(b.proteinGood, true);
});

console.log(`\n${n} tests passed`);
