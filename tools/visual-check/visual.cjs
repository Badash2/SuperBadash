// Visual check of SuperBadash: the real site in Chromium on a phone screen, light/dark.
// Supabase calls are answered from a local Postgres (same SQL functions, RLS as a family member),
// so the full flow can be tested without a Google login. Setup: see README.md in this directory.
//
//   SCHEME=light node visual.cjs     (or dark)  ->  screenshots in ./out/
const { chromium, devices } = require("playwright");
const { Pool } = require("pg");
const OUT = require("path").join(__dirname, "out");
require("fs").mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:3100";
const DB_URL = process.env.LOCAL_DB_URL || "postgresql://sb:sb@localhost/sbsupa";
const EMAIL = process.env.EMAIL || "badash2@gmail.com";
const REF = "hzyqvkqkozabwhhpxngy";
const db = new Pool({ connectionString: DB_URL, max: 8 });
const log = [];
const errors = [];
let PAGE;
let PAGE_UPLOADS = [];

async function asFamily(sql, params) {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE authenticated");
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ email: EMAIL })]);
    const r = await c.query(sql, params);
    await c.query("COMMIT");
    return r.rows;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
const ident = (s) => '"' + s.replace(/"/g, "") + '"';

function where(params, args) {
  const conds = [];
  for (const [k, v] of params) {
    if (["select", "order", "limit", "on_conflict", "columns"].includes(k)) continue;
    let m;
    if ((m = v.match(/^eq\.(.*)$/))) { args.push(m[1]); conds.push(`${ident(k)}::text = $${args.length}`); }
    else if ((m = v.match(/^ilike\.(.*)$/))) { args.push(m[1]); conds.push(`${ident(k)} ilike $${args.length}`); }
    else if ((m = v.match(/^gte\.(.*)$/))) { args.push(m[1]); conds.push(`${ident(k)} >= $${args.length}`); }
    else if ((m = v.match(/^lte\.(.*)$/))) { args.push(m[1]); conds.push(`${ident(k)} <= $${args.length}`); }
    else if ((m = v.match(/^in\.\((.*)\)$/))) {
      const vals = m[1].match(/("([^"]*)"|[^,]+)/g).map((x) => x.replace(/^"|"$/g, ""));
      args.push(vals); conds.push(`${ident(k)}::text = any($${args.length})`);
    }
    else if (v === "not.is.null") conds.push(`${ident(k)} is not null`);
    else if (v === "is.null") conds.push(`${ident(k)} is null`);
    else throw new Error("unsupported filter " + k + "=" + v);
  }
  return conds.length ? " where " + conds.join(" and ") : "";
}

async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  const path = url.pathname.replace("/rest/v1/", "");
  const method = req.method();
  const accept = req.headers()["accept"] || "";
  const prefer = req.headers()["prefer"] || "";
  const params = [...url.searchParams.entries()];
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  let rows = [];
  try {
    if (path.startsWith("rpc/")) {
      const fn = path.slice(4);
      const keys = Object.keys(body || {});
      rows = await asFamily(
        `select * from public.${ident(fn)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ")})`,
        keys.map((k) => body[k]),
      );
    } else {
      const args = [];
      const sel = url.searchParams.get("select") || "*";
      const cols = sel === "*" ? "*" : sel.split(",").map(ident).join(",");
      if (method === "GET") {
        let sql = `select ${cols} from public.${ident(path)}` + where(params, args);
        const order = url.searchParams.get("order");
        if (order)
          sql += " order by " + order.split(",").map((o) => { const [c, d] = o.split("."); return ident(c) + (d === "desc" ? " desc" : ""); }).join(",");
        if (url.searchParams.get("limit")) sql += " limit " + parseInt(url.searchParams.get("limit"));
        rows = await asFamily(sql, args);
      } else if (method === "POST") {
        const list = Array.isArray(body) ? body : [body];
        const keys = Object.keys(list[0]);
        const vals = list.map((r) => "(" + keys.map((k) => { args.push(r[k]); return `$${args.length}`; }).join(",") + ")").join(",");
        let sql = `insert into public.${ident(path)} (${keys.map(ident).join(",")}) values ${vals}`;
        // Like PostgREST: on_conflict if given, otherwise the table's primary key
        const PK = { item_categories: "item_key", notification_prefs: "email", member_status: "email", push_subscriptions: "endpoint" };
        const pk = url.searchParams.get("on_conflict") || PK[path] || "code";
        if (prefer.includes("merge-duplicates"))
          sql += ` on conflict (${pk}) do update set ` + keys.filter((k) => k !== pk).map((k) => `${ident(k)} = excluded.${ident(k)}`).join(",");
        rows = await asFamily(sql + " returning *", args);
      } else if (method === "PATCH") {
        const keys = Object.keys(body);
        const set = keys.map((k) => { args.push(body[k]); return `${ident(k)} = $${args.length}`; }).join(",");
        rows = await asFamily(`update public.${ident(path)} set ${set}` + where(params, args) + " returning *", args);
      } else if (method === "DELETE") {
        rows = await asFamily(`delete from public.${ident(path)}` + where(params, args) + " returning *", args);
      }
    }
    log.push(`${method} ${path} ok`);
    const payload = accept.includes("vnd.pgrst.object") ? rows[0] ?? null : rows;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  } catch (e) {
    log.push(`${method} ${path} !! ${e.message}`);
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: e.message, code: e.code }) });
  }
}

function fakeSession() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600 * 6;
  const user = {
    id: "00000000-0000-0000-0000-000000000001", aud: "authenticated", role: "authenticated", email: EMAIL,
    user_metadata: { full_name: "בדיקה" }, app_metadata: { provider: "google" }, created_at: new Date().toISOString(),
  };
  const token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, email: EMAIL, role: "authenticated", aud: "authenticated", exp })}.sig`;
  return { access_token: token, refresh_token: "r", token_type: "bearer", expires_in: 21600, expires_at: exp, user };
}


const SCHEME = process.env.SCHEME || "light";
const P = (n) => `${OUT}/${SCHEME}-${n}.png`;
async function simulateHistory(code) {
  // Simulated history (local test DB only!): went up at Rami Levy, went down at Shufersal Deal - so the chart, insights and feed have movement
  const d = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 19);
  const cur = Object.fromEntries((await db.query("select store_key, price from current_prices where code=$1", [code])).rows.map((r) => [r.store_key, r.price]));
  for (const [store, price] of Object.entries(cur)) {
    const start = store === "rami-levy-yahalom" ? +(price * 0.88).toFixed(2) : store === "shufersal-deal-hakadar" ? +(price * 1.06).toFixed(2) : price;
    await db.query("insert into price_changes (store_key, code, changed_at, old_price, new_price) values ($1,$2,$3,null,$4) on conflict do nothing", [store, code, d(80), start]);
    if (start !== price) await db.query("insert into price_changes (store_key, code, changed_at, old_price, new_price) values ($1,$2,$3,$4,$5) on conflict do nothing", [store, code, d(store === "rami-levy-yahalom" ? 3 : 25), start, price]);
  }
}

(async () => {
  await db.query("delete from price_changes where changed_at < '2026-11-11'");
  await db.query("truncate shopping_items, purchases, item_categories, notification_prefs");
  const browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${OUT}/barcode.y4m`],
  });
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "he-IL", colorScheme: SCHEME, permissions: ["camera"] });
  await ctx.route(`https://${REF}.supabase.co/rest/v1/**`, handle);
  // Storage (photo uploads): a fake reply; recorded so we can check an upload happened
  const uploads = [];
  await ctx.route(`https://${REF}.supabase.co/storage/v1/**`, (r) => {
    uploads.push(new URL(r.request().url()).pathname);
    return r.fulfill({ status: 200, contentType: "application/json", body: '{"Key":"ok"}' });
  });
  PAGE_UPLOADS = uploads;
  // The notification endpoints are tested separately (notify-api.cjs); here we only check that the UI calls them
  const apiCalls = [];
  await ctx.route(`${BASE}/api/**`, (r) => { apiCalls.push(new URL(r.request().url()).pathname); return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"sent":0}' }); });
  await ctx.route(`https://${REF}.supabase.co/auth/v1/**`, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeSession().user) }));
  const page = await ctx.newPage();
  PAGE = page;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/websocket|realtime/i.test(m.text())) errors.push(m.text()); });

  await page.goto(BASE + "/");
  await page.getByText("כניסה עם Google").waitFor();
  await page.screenshot({ path: P("1-login") });
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(fakeSession())]);
  await page.reload();
  const input = page.getByPlaceholder("מה צריך?", { exact: false });
  await input.waitFor();

  for (const q of ["חלב 3% 1 ל", "קוטג 5%", "שמן קנולה", "טופיפי", "פסטה ברילה", "חזה עוף", "נייר טואלט"]) {
    await input.fill(q);
    await page.locator("div.absolute button").nth(1).waitFor({ timeout: 10000 });
    await page.locator("div.absolute button").first().click();
    await page.waitForTimeout(350);
  }
  await page.getByText("ירקות ופירות בלחיצה").click();
  await page.getByRole("button", { name: "🍅 עגבניות" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "🍌 בננות" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "🥬 חסה" }).click();
  await page.waitForTimeout(300);
  await input.fill("גלידה וניל");
  await page.getByRole("button", { name: "הוסיפו", exact: true }).click();
  await page.waitForTimeout(500);

  // Units: tomatoes start in kg, + adds half a kilo, tap = switch to units; lettuce = units; a packaged product = units, not switchable
  await page.waitForTimeout(600);
  const tomRow = page.locator("li", { hasText: "עגבניות" }).first();
  await tomRow.getByRole("button", { name: "עוד" }).click();
  await page.waitForTimeout(500);
  const unitsA = (await db.query("select name, quantity::text q, unit from shopping_items order by added_at")).rows;
  await page.screenshot({ path: P("2a-units"), fullPage: true });
  await tomRow.getByRole("button", { name: /כמות .*להחלפה/ }).click();
  await page.waitForTimeout(500);
  const tomAfter = (await db.query("select quantity::text q, unit from shopping_items where name='עגבניות'")).rows[0];
  const packagedSwitchable = await page.locator("li", { hasText: "נייר טואלט" }).first().getByRole("button", { name: /להחלפה/ }).count();
  console.log("units:", unitsA.filter((r) => /עגבניות|בננות|חסה|נייר/.test(r.name)).map((r) => `${r.name}=${r.q} ${r.unit}`).join(" | "),
    "| tomatoes after switch:", JSON.stringify(tomAfter), "| packaged switchable:", packagedSwitchable);
  await tomRow.getByRole("button", { name: /כמות .*להחלפה/ }).click(); // back to kg for the rest of the test
  await page.waitForTimeout(300);

  // Barcode scan (fake camera with a Bamba EAN-13)
  await page.getByRole("button", { name: "סריקת ברקוד" }).click();
  await page.getByText("✓", { exact: false }).last().waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: P("2-scanner") });
  const scanned = await page.locator(".fixed.inset-0 p.font-semibold").innerText();
  await page.getByRole("button", { name: "סיום" }).click();
  await page.waitForTimeout(4500);
  await page.screenshot({ path: P("3-list"), fullPage: true });

  // Change a section: ice cream -> stays frozen; move toilet paper to "other" and back as a test
  const sel = page.locator('select[aria-label="מחלקה"]').first();
  await sel.selectOption("frozen");
  await page.waitForTimeout(600);
  const overrides = (await db.query("select item_key, category from item_categories")).rows;

  await page.locator("select").first().selectOption("yochananof-netanya");
  await page.waitForTimeout(600);
  await page.screenshot({ path: P("4-in-store"), fullPage: true });

  await page.locator("nav button").nth(2).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: P("5-compare"), fullPage: true });
  await page.locator("nav button").nth(3).click();
  await page.getByText("המבצעים האמיתיים הכי טובים", { exact: false }).waitFor();
  await page.waitForTimeout(2500);
  const initialSel = await page.locator("[aria-label=\"סינון לפי סופר\"] [aria-selected=true]").innerText();
  await page.getByRole("tab", { name: "רמי לוי" }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: P("6-deals") });
  const cardStores = await page.locator("section").last().locator("div.flex.flex-wrap.items-center span:nth-child(2)").allInnerTexts();
  const dbCount = (await db.query("select count(*)::int n from deals where verdict='real' and store_key='rami-levy-yahalom' and market_saving_pct between 15 and 70")).rows[0].n;
  await page.getByRole("tab", { name: "כל הסניפים" }).click();
  await page.waitForTimeout(2500);
  const allStores = await page.locator("section").last().locator("div.flex.flex-wrap.items-center span:nth-child(2)").allInnerTexts();
  console.log("deals filter: initial chip =", initialSel, "| rami-levy cards:", cardStores.length, "distinct:", [...new Set(cardStores)], "| db real deals at rami levy:", dbCount, "| all-stores distinct:", [...new Set(allStores)]);

  // Product card: open, highlight a store, range, touch the chart, alternatives
  const cottage = (await db.query("select code, name from shopping_items where name like 'קוטג%' limit 1")).rows[0];
  await simulateHistory(cottage.code);
  await page.locator("nav button").first().click();
  await page.getByRole("button", { name: /קוטג/ }).first().click();
  await page.getByText("הכי זול עכשיו").waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.getByRole("tab", { name: "3 חודשים" }).click();
  await page.waitForTimeout(500);
  const box = await page.locator("svg[role=img]").boundingBox();
  if (box) await page.mouse.move(box.x + box.width * 0.35, box.y + box.height / 2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: P("8-product"), fullPage: true });
  const sheet = {
    insights: await page.locator("[role=dialog] section ul.space-y-1 li").allInnerTexts(),
    alternatives: await page.getByText("חלופות זולות יותר").count(),
    tooltip: await page.locator("div[dir=rtl].pointer-events-none").count(),
  };
  console.log("product sheet:", JSON.stringify(sheet).slice(0, 400));
  await page.getByRole("button", { name: "חזרה" }).click();
  await page.locator("nav button").nth(3).click();
  await page.getByRole("tab", { name: "כל הסניפים" }).click(); // the tab opens filtered to the current store
  await page.getByText("שינויי מחיר אצלכם השבוע").waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: P("9-price-moves") });
  console.log("price moves:", (await page.locator("ul.divide-y li").first().innerText()).replace(/\s+/g, " "));

  // Deals gallery: large images
  await page.getByRole("tab", { name: "גלריה" }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: P("10-deals-grid") });
  const tiles = await page.locator("div.grid.grid-cols-2 > div").count();
  await page.getByRole("tab", { name: "רשימה" }).click();

  // Product card for Bamba: health (the research results), notes, a research request, a photo upload
  await db.query("delete from research_requests where code='7290000066318'");
  await db.query("delete from product_notes where code='7290000066318'");
  await page.locator("nav button").first().click();
  await page.getByRole("button", { name: /^במבה 80 גרם/ }).first().click();
  await page.getByText("בריאות וערכים תזונתיים").waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  const badges = await page.locator("[role=dialog] section").filter({ hasText: "בריאות וערכים תזונתיים" }).locator("div.flex.flex-wrap.gap-2 > span").allInnerTexts();
  await page.getByPlaceholder("למשל: הילדים לא אוהבים", { exact: false }).fill("הילדים אוהבים, לקנות 2");
  await page.getByRole("button", { name: "הוסיפו", exact: true }).last().click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "חפשו לי בסבב הבא" }).click();
  await page.waitForTimeout(600);
  await page.locator('input[type=file][accept="image/*"]').setInputFiles(`${OUT}/barcode.png`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: P("11-product-health"), fullPage: false });
  await page.locator("[role=dialog]").evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(400);
  await page.screenshot({ path: P("12-product-bottom") });
  const notes = (await db.query("select body from product_notes where code='7290000066318'")).rows.map((r) => r.body);
  const reqs = (await db.query("select kind, status, photo_path is not null as has_photo from research_requests where code='7290000066318' order by requested_at")).rows;
  console.log("deals grid tiles:", tiles, "| health badges:", JSON.stringify(badges));
  console.log("notes:", JSON.stringify(notes), "| research requests:", JSON.stringify(reqs), "| uploads:", PAGE_UPLOADS.length);
  await page.getByRole("button", { name: "חזרה" }).click();

  // Settings: changing preferences is saved for the user
  await page.getByRole("button", { name: "הגדרות" }).click();
  await page.getByText("🔔 התראות במכשיר הזה").waitFor();
  await page.getByRole("radio", { name: /כל מבצע אמיתי חדש/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "אודליה", exact: true }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: P("7-settings"), fullPage: true });
  const prefs = (await db.query("select deals, ran_out_from from notification_prefs where email=$1", [EMAIL])).rows[0];
  console.log("settings saved:", JSON.stringify(prefs), "| notify calls:", [...new Set(apiCalls)]);
  const items = (await db.query("select name, checked from shopping_items order by added_at")).rows;
  console.log("scanned:", scanned);
  console.log("items:", items.map((i) => i.name + (i.checked ? "✓" : "")).join(" | "));
  console.log("overrides:", JSON.stringify(overrides));
  console.log("errors:", errors.length ? errors : "none");
  await browser.close();
  await db.end();
})().catch(async (e) => {
  console.error("FAILED", e.message.split("\n")[0]);
  console.log("page errors:", errors);
  if (PAGE) await PAGE.screenshot({ path: `${OUT}/fail.png`, fullPage: true });
  process.exit(1);
});
