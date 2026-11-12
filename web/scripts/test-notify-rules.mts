// Tests for the notification rules. Run: node scripts/test-notify-rules.mts (Node 22+ strips types on its own)
import assert from "node:assert/strict";
import {
  DEFAULT_PREFS,
  isDigestHour,
  isQuietHour,
  israelClock,
  listAddRecipients,
  ranOutEachRecipients,
  ranOutSourceAllowed,
  relevantDeals,
  type DealLite,
  type Prefs,
} from "../src/lib/notify-rules.ts";

const ABA = "badash2@gmail.com";
const IMA = "odelyamor@gmail.com";
const KID = "totobadash@gmail.com";
const members = [ABA, IMA, KID];
const p = (email: string, o: Partial<Prefs> = {}): Prefs => ({ email, ...DEFAULT_PREFS, ...o });
let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("✓", name);
};

// 2026-11-12 is winter time: Israel = UTC+2
const at = (hhIsrael: number) => new Date(Date.UTC(2026, 10, 12, (hhIsrael - 2 + 24) % 24, 10));

t("Israel clock handles the time zone", () => {
  assert.equal(israelClock(at(19)).hour, 19);
  assert.equal(israelClock(at(19)).date, "2026-11-12");
  assert.equal(israelClock(new Date(Date.UTC(2026, 6, 1, 16, 0))).hour, 19); // summer: UTC+3
});

t("quiet hours 22:00-07:00", () => {
  assert.equal(isQuietHour(at(23)), true);
  assert.equal(isQuietHour(at(6)), true);
  assert.equal(isQuietHour(at(7)), false);
  assert.equal(isQuietHour(at(21)), false);
});

t("list addition: the one who added never gets it; default = only whoever is in the store", () => {
  const now = at(18);
  const status = [{ email: ABA, current_store: "rami-levy-yahalom", updated_at: new Date(now.getTime() - 20 * 60000).toISOString() }];
  assert.deepEqual(listAddRecipients(members, [], status, IMA, now), [ABA]);
  assert.deepEqual(listAddRecipients(members, [], status, ABA, now), []); // dad added it himself
});

t("list addition: 'in the store' expires after 3 hours; 'always' / 'off' respected", () => {
  const now = at(18);
  const stale = [{ email: ABA, current_store: "rami-levy-yahalom", updated_at: new Date(now.getTime() - 4 * 3600000).toISOString() }];
  assert.deepEqual(listAddRecipients(members, [], stale, IMA, now), []);
  const prefs = [p(KID, { list_adds: "always" }), p(ABA, { list_adds: "off" })];
  const fresh = [{ email: ABA, current_store: "x", updated_at: now.toISOString() }];
  assert.deepEqual(listAddRecipients(members, prefs, fresh, IMA, now), [KID]);
});

t("ran out: source filter - only when Odelia scans", () => {
  const onlyIma = p(ABA, { ran_out_from: [IMA] });
  assert.equal(ranOutSourceAllowed(onlyIma, IMA), true);
  assert.equal(ranOutSourceAllowed(onlyIma, KID), false);
  assert.equal(ranOutSourceAllowed(onlyIma, null), false); // an unidentified scan at the bin
  assert.equal(ranOutSourceAllowed(p(ABA, { ran_out_from: [IMA, "kiosk"] }), null), true);
  assert.equal(ranOutSourceAllowed(p(ABA), KID), true); // default = everyone
});

t("ran out immediately: only 'each', and not during quiet hours", () => {
  const prefs = [p(ABA, { ran_out: "each" }), p(IMA, { ran_out: "each", quiet: false }), p(KID, { ran_out: "daily" })];
  assert.deepEqual(ranOutEachRecipients(members, prefs, null, at(12)), [ABA, IMA]);
  assert.deepEqual(ranOutEachRecipients(members, prefs, null, at(23)), [IMA]);
});

t("daily digest at the chosen hour", () => {
  assert.equal(isDigestHour(p(ABA, { digest_hour: 19 }), at(19)), true);
  assert.equal(isDigestHour(p(ABA, { digest_hour: 19 }), at(18)), false);
});

t("deals: only ours, frequent first, one per product; 'ours_plus_top' adds strong general ones", () => {
  const d = (code: string, store: string, pct: number, verdict = "real"): DealLite => ({
    store_key: store, code, promo_id: "1", verdict, market_saving_pct: pct, promo_unit_price: 1, regular_price: 2, description: "",
  });
  const deals = [d("milk", "a", 10), d("milk", "b", 20), d("bamba", "a", 30), d("caviar", "a", 60), d("cola", "a", 40, "fake")];
  const ours = new Map([["milk", 5], ["bamba", 1], ["cola", 9]]);
  const r = relevantDeals(deals, ours, "ours");
  assert.deepEqual(r.map((x) => x.code), ["milk", "bamba"]); // fake cola excluded, milk once (bought more)
  assert.equal(r[0].store_key, "b"); // the bigger saving among the two stores
  assert.deepEqual(relevantDeals(deals, ours, "ours_plus_top").map((x) => x.code), ["milk", "bamba", "caviar"]);
});

console.log(`\n${n} tests passed`);
