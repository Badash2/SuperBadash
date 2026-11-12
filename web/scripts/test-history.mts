// Tests for the price-history logic. Run: npm test
import assert from "node:assert/strict";
import { buildSeries, cheaperAlternatives, insights, normalizedSize, priceAt, type Candidate, type Change } from "../src/lib/history.ts";

let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("✓", name);
};
const D = (d: number) => Date.UTC(2026, 10, d, 12);
const iso = (d: number) => new Date(D(d)).toISOString().slice(0, 19);
const ils = (x: number) => `₪${x.toFixed(2)}`;

t("step series: price before the range = starting point; extends to 'now'", () => {
  const ch: Change[] = [
    { store_key: "rl", changed_at: iso(1), old_price: null, new_price: 5.5 },
    { store_key: "rl", changed_at: iso(10), old_price: 5.5, new_price: 5.9 },
    { store_key: "sh", changed_at: iso(2), old_price: null, new_price: 6.1 },
  ];
  const s = buildSeries(ch, D(5), D(20));
  assert.deepEqual(s.map((x) => x.store), ["rl", "sh"]); // cheapest first
  const rl = s[0];
  assert.deepEqual(rl.points, [{ t: D(5), price: 5.5 }, { t: D(10), price: 5.9 }, { t: D(20), price: 5.9 }]);
  assert.equal(priceAt(rl, D(7)), 5.5);
  assert.equal(priceAt(rl, D(12)), 5.9);
});

t("insights: up/down with percent, period low, gap between stores", () => {
  const ch: Change[] = [
    { store_key: "rl", changed_at: iso(1), old_price: null, new_price: 5.5 },
    { store_key: "rl", changed_at: iso(10), old_price: 5.5, new_price: 6.05 },
    { store_key: "sh", changed_at: iso(2), old_price: null, new_price: 7.2 },
  ];
  const s = buildSeries(ch, D(1), D(20));
  const out = insights(s, D(1), (k) => (k === "rl" ? "רמי לוי" : "שופרסל"), ils);
  assert.equal(out[0].kind, "up");
  assert.match(out[0].text, /עלה 10% ברמי לוי/);
  assert.match(out.find((i) => i.kind === "low")!.text, /₪5.50 ברמי לוי/);
  assert.match(out.find((i) => i.kind === "info")!.text, /₪1.15/);
});

t("insights: no change -> no 'up/down' line", () => {
  const s = buildSeries([{ store_key: "rl", changed_at: iso(1), old_price: null, new_price: 5 }], D(1), D(9));
  assert.equal(insights(s, D(1), () => "x", ils).filter((i) => i.kind === "up" || i.kind === "down").length, 0);
});

t("normalised sizes from the chains' units", () => {
  assert.deepEqual(normalizedSize(250, "100 גרם"), { family: "g", amount: 250 });
  assert.deepEqual(normalizedSize(1, "1קילוגרם"), { family: "g", amount: 1000 });
  assert.deepEqual(normalizedSize(1.5, "ליטר"), { family: "ml", amount: 1500 });
  assert.deepEqual(normalizedSize(500, '100 מ"ל'), { family: "ml", amount: 500 });
  assert.equal(normalizedSize(1, "לא ידוע"), null);
});

t("cheaper alternatives: same type/fat/size, not 9% instead of 5%, not 'with olives'", () => {
  const c = (code: string, name: string, price: number, q = 250, unit = "100 גרם"): Candidate => ({
    code, name, quantity: q, unit, min_price: price, store_count: 6,
  });
  const target = c("tnuva5", "קוטג 5% תנובה 250 גר", 6.1);
  const cands = [
    target,
    c("strauss5", "קוטג 5% שטראוס 250 ג", 5.6), // ✓ cheaper by 8%
    c("tara5", "קוטג 5% טרה 250 גרם", 5.9), // ✓ cheaper by 3% -> below the 5% threshold, excluded
    c("tnuva9", "קוטג 9% תנובה 250 גר", 5.0), // ✗ a different fat percentage
    c("olives", "קוטג 5% עם זיתים 250 גר", 5.0), // ✗ a different product (name too different)
    c("small", "קוטג בקטנה 5% 100 גרם", 2.0, 100), // ✗ a different size
    c("yogurt", "יוגורט 5% 250 גרם", 3.0), // ✗ different first word
  ];
  const alt = cheaperAlternatives(target, cands);
  assert.deepEqual(alt.map((a) => a.code), ["strauss5"]);
  assert.ok(alt[0].saving > 0.07 && alt[0].saving < 0.09);
});

console.log(`\n${n} tests passed`);
