// Tests for the item symbols and default units. Run: npm test
import assert from "node:assert/strict";
import { defaultUnit, formatQty, itemEmoji, stepQty, switchUnit } from "../src/lib/produce.ts";

let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("✓", name);
};

t("every quick-add vegetable/fruit has its own symbol (not lettuce for everything)", () => {
  const quick = ["עגבניות", "מלפפונים", "בננות", "תפוחים", "בצל", "תפוחי אדמה", "גזר", "פלפל אדום",
    "אבוקדו", "לימונים", "חסה", "פטרוזיליה", "שום", "בטטה", "קישואים", "תפוזים"];
  const got = quick.map((q) => itemEmoji(q));
  assert.ok(got.every(Boolean), "missing: " + quick.filter((q, i) => !got[i]).join(","));
  assert.equal(itemEmoji("עגבניות"), "🍅");
  assert.equal(itemEmoji("תפוחי אדמה"), "🥔"); // not 🍎
  assert.equal(itemEmoji("פלפל חריף"), "🌶️"); // not 🫑
  assert.equal(itemEmoji("בננות"), "🍌");
  assert.ok(new Set(got).size >= 13, "too many symbols repeat");
});

t("default unit: produce by weight, sold-by-the-unit as units, packaged = units, weighed = kg", () => {
  assert.equal(defaultUnit("עגבניות"), "kg");
  assert.equal(defaultUnit("בננות"), "kg");
  assert.equal(defaultUnit("חסה"), "units");
  assert.equal(defaultUnit("פטרוזיליה"), "units");
  assert.equal(defaultUnit("אבטיח"), "units");
  assert.equal(defaultUnit("נייר טואלט"), "units");
  assert.equal(defaultUnit("במבה", { code: "7290000066318" }), "units");
  assert.equal(defaultUnit("חזה עוף טרי", { code: "x:1", weighted: true }), "kg");
});

t("steps: units by 1 (min 1), kg by half (min half)", () => {
  assert.equal(stepQty(1, "units", 1), 2);
  assert.equal(stepQty(1, "units", -1), 1);
  assert.equal(stepQty(1, "kg", 1), 1.5);
  assert.equal(stepQty(0.5, "kg", -1), 0.5);
  assert.equal(stepQty(1.5, "kg", -1), 1);
});

t("display and unit switching", () => {
  assert.equal(formatQty(1.5, "kg"), "1.5 ק״ג");
  assert.equal(formatQty(6, "units"), "6 יח׳");
  assert.deepEqual(switchUnit(2.5, "kg"), { unit: "units", quantity: 3 });
  assert.deepEqual(switchUnit(6, "units"), { unit: "kg", quantity: 1 });
});

console.log(`\n${n} tests passed`);
