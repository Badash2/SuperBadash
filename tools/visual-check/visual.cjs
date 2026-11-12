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
        const pk = path === "item_categories" ? "item_key" : "code";
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
(async () => {
  await db.query("truncate shopping_items, purchases, item_categories");
  const browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${OUT}/barcode.y4m`],
  });
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "he-IL", colorScheme: SCHEME, permissions: ["camera"] });
  await ctx.route(`https://${REF}.supabase.co/rest/v1/**`, handle);
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
  await page.getByRole("button", { name: "+ עגבניות" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "+ בננות" }).click();
  await page.waitForTimeout(300);
  await input.fill("גלידה וניל");
  await page.getByRole("button", { name: "הוסיפו", exact: true }).click();
  await page.waitForTimeout(500);

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
  const initialSel = await page.locator('[role="tab"][aria-selected="true"]').innerText();
  await page.getByRole("tab", { name: "רמי לוי" }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: P("6-deals") });
  const cardStores = await page.locator("section").last().locator("div.flex.flex-wrap.items-center span:nth-child(2)").allInnerTexts();
  const dbCount = (await db.query("select count(*)::int n from deals where verdict='real' and store_key='rami-levy-yahalom' and market_saving_pct between 15 and 70")).rows[0].n;
  await page.getByRole("tab", { name: "כל הסניפים" }).click();
  await page.waitForTimeout(2500);
  const allStores = await page.locator("section").last().locator("div.flex.flex-wrap.items-center span:nth-child(2)").allInnerTexts();
  console.log("deals filter: initial chip =", initialSel, "| rami-levy cards:", cardStores.length, "distinct:", [...new Set(cardStores)], "| db real deals at rami levy:", dbCount, "| all-stores distinct:", [...new Set(allStores)]);

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
