// Server test for notifications: the real route handlers (next start) against mock-supabase + a fake push service.
// Checks: who receives what per settings, duplicate prevention, actor verification, digests, "every deal" with a baseline,
// and cleanup of a device that unsubscribed (410).
//   prerequisites: node mock-supabase.cjs &  and the site built with NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321,
//   running with SUPABASE_SECRET_KEY=dummy VAPID_PRIVATE_KEY=... NODE_TLS_REJECT_UNAUTHORIZED=0 (test only!) on port 3200
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const assert = require("assert/strict");
const { Pool } = require("pg");

const BASE = process.env.BASE_URL || "http://localhost:3200";
const db = new Pool({ connectionString: process.env.LOCAL_DB_URL || "postgresql://sb:sb@localhost/sbsupa" });
const ABA = "badash2@gmail.com", IMA = "odelyamor@gmail.com", KID = "totobadash@gmail.com";

// --- fake push service: records which device got what ---
const got = [];
// HTTPS like a real push service (web-push only sends over HTTPS); a self-signed cert trusted only by the test server
const pushSrv = https.createServer({ key: fs.readFileSync(path.join(__dirname, "out/push-key.pem")), cert: fs.readFileSync(path.join(__dirname, "out/push-cert.pem")) }, (req, res) => {
  let n = 0;
  req.on("data", (c) => (n += c.length));
  req.on("end", () => {
    const who = req.url.split("/").pop();
    got.push({ who, bytes: n, ttl: req.headers.ttl, vapid: /^vapid t=/.test(req.headers.authorization || "") });
    res.writeHead(who === "gone" ? 410 : 201);
    res.end();
  });
}).listen(4545);

const b64u = (b) => Buffer.from(b).toString("base64url");
function deviceKeys() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(crypto.randomBytes(16)) };
}
const post = (path, email, body) =>
  fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(email ? { authorization: `Bearer tok:${email}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const take = () => got.splice(0).map((g) => g.who).sort();
const israelHour = () => Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(new Date())) % 24;
let n = 0;
const ok = (name) => { n++; console.log("✓", name); };

(async () => {
  await db.query("truncate notification_prefs, push_subscriptions, member_status, notification_log, shopping_items, consumed_items, purchases");
  const hour = israelHour();
  for (const [email, dev] of [[ABA, "aba"], [IMA, "ima"], [KID, "kid"]]) {
    const k = deviceKeys();
    await db.query("insert into push_subscriptions (endpoint,email,p256dh,auth) values ($1,$2,$3,$4)", [`https://localhost:4545/push/${dev}`, email, k.p256dh, k.auth]);
  }
  const g = deviceKeys();
  await db.query("insert into push_subscriptions (endpoint,email,p256dh,auth) values ($1,$2,$3,$4)", ["https://localhost:4545/push/gone", KID, g.p256dh, g.auth]);
  // dad: list only while in the store; ran out immediately but only from Odelia; deals daily now
  // Odelia: list always; ran out immediately from everyone. The kid: deals - every new deal.
  // The digest hour (current hour + 2) is not "now", so their digests don't interfere with the immediate checks.
  const off = (hour + 2) % 24 < 6 ? 12 : (hour + 2) % 24;
  await db.query(`insert into notification_prefs (email,list_adds,ran_out,ran_out_from,deals,deals_scope,digest_hour,quiet) values
    ($1,'in_store','each',array[$2],'daily','ours',$4,false),
    ($2,'always','each',null,'off','ours',$5,false),
    ($3,'off','off',null,'each','ours_plus_top',$5,false)`, [ABA, IMA, KID, Math.max(6, hour), off]);
  await db.query("insert into member_status (email,current_store,updated_at) values ($1,'rami-levy-yahalom',now())", [ABA]);

  // ---- security ----
  assert.equal((await post("/api/notify/event", null, { type: "list_add", id: "x" })).status, 401);
  assert.equal((await post("/api/notify/event", "stranger@gmail.com", { type: "list_add", id: "x" })).status, 401);
  ok("without a token / a stranger -> 401");

  // ---- list addition (by Odelia) ----
  const it = (await db.query("insert into shopping_items (code,name,added_by) values ('7290000066318','במבה 80 גרם',$1) returning id", [IMA])).rows[0].id;
  assert.equal((await post("/api/notify/event", ABA, { type: "list_add", id: it })).status, 404); // dad is impersonating her
  ok("actor check: you can't send a notification on someone else's row");
  let r = await post("/api/notify/event", IMA, { type: "list_add", id: it });
  assert.equal(r.status, 200);
  assert.deepEqual(take(), ["aba"]); // dad is in the store; Odelia added it herself; the kid chose "off"
  ok("list addition -> only dad (in the store), not whoever added it");
  r = await post("/api/notify/event", IMA, { type: "list_add", id: it });
  assert.equal(r.sent, 0);
  assert.deepEqual(take(), []);
  ok("a double trigger -> no double send");

  // ---- scan at the bin (the scanner account is dad's) ----
  const s1 = (await db.query("insert into consumed_items (code,name,scanned_by,scanned_as) values ('7290004131074','חלב 3%',$1,$2) returning id", [ABA, IMA])).rows[0].id;
  await post("/api/notify/event", ABA, { type: "ran_out", id: s1 });
  assert.deepEqual(take(), ["aba", "ima"]);
  const s2 = (await db.query("insert into consumed_items (code,name,scanned_by,scanned_as) values ('7290000066318','במבה',$1,$2) returning id", [ABA, KID])).rows[0].id;
  await post("/api/notify/event", ABA, { type: "ran_out", id: s2 });
  assert.deepEqual(take(), ["ima"]); // dad filtered: only scans by Odelia
  ok("ran out: dad only from Odelia's scans; Odelia from everyone");

  // ---- periodic run: dad's daily digests + the kid's "every deal" (baseline, then only new ones) ----
  const deal = (await db.query("select code, store_key from deals where verdict='real' and market_saving_pct between 15 and 60 order by market_saving_pct desc limit 1")).rows[0];
  await db.query("insert into purchases (trip_id,code,name,store_key,seq) values (gen_random_uuid(),$1,'מוצר שאנחנו קונים',$2,0)", [deal.code, deal.store_key]);
  r = await post("/api/notify/run");
  assert.equal(r.status, 200);
  const first = take();
  assert.ok(first.includes("aba"), "dad gets a digest at his hour");
  assert.ok(!first.includes("kid"), "the kid: first time = a baseline without sending");
  console.log("  run #1:", JSON.stringify(r));
  ok("daily digest at the right hour; 'every deal' starts with a baseline (no bombardment)");
  r = await post("/api/notify/run");
  assert.deepEqual(take(), []);
  ok("a second run in the same hour -> nothing (no duplicates)");

  const other = (await db.query("select code, store_key, promo_id from deals where verdict='real' and market_saving_pct between 25 and 70 and code <> $1 order by market_saving_pct desc limit 1", [deal.code])).rows[0];
  await db.query("insert into purchases (trip_id,code,name,store_key,seq) values (gen_random_uuid(),$1,'עוד מוצר',$2,0)", [other.code, other.store_key]);
  await db.query("delete from notification_log where email=$1 and kind='deal' and ref like $2", [KID, `%:${other.code}:%`]); // a new deal on our product
  r = await post("/api/notify/run");
  const third = take();
  assert.ok(third.includes("kid"), "the kid gets the new deal");
  ok("a new deal on our product -> sent to whoever chose 'every deal'");

  // ---- an unsubscribed device (410) is removed ----
  const gone = (await db.query("select count(*)::int n from push_subscriptions where endpoint like '%/gone'")).rows[0].n;
  assert.equal(gone, 0);
  ok("a device that returned 410 was removed from the list");

  assert.ok(got.length === 0 || got.every((x) => x.vapid));
  console.log(`\n${n} server checks passed`);
  pushSrv.close();
  await db.end();
})().catch((e) => {
  console.error("FAILED:", e.message);
  console.error("pushes received:", JSON.stringify(got));
  process.exit(1);
});
