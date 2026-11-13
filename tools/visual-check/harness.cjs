// Shared harness for the kiosk tests: Supabase REST answered from the local Postgres (RLS as a family member) + a fake session.
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

module.exports = { chromium, devices, db, OUT, BASE, REF, EMAIL, log, asFamily, handle, fakeSession };
