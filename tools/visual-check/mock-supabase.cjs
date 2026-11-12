// A minimal Supabase stand-in for server tests: PostgREST-like REST over the local Postgres (as the admin
// user, like the secret key) + /auth/v1/user. A token of the form "tok:<email>" identifies the user.
// Run: node mock-supabase.cjs  (port 54321)
const http = require("http");
const { Pool } = require("pg");

const db = new Pool({ connectionString: process.env.LOCAL_DB_URL || "postgresql://sb:sb@localhost/sbsupa", max: 8 });
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

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let raw = "";
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : null;
  try {
    if (url.pathname === "/auth/v1/user") {
      const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!tok.startsWith("tok:")) return send(res, 401, { message: "invalid token" });
      return send(res, 200, { id: "u-" + tok.slice(4), email: tok.slice(4), aud: "authenticated" });
    }
    const path = url.pathname.replace("/rest/v1/", "");
    const params = [...url.searchParams.entries()];
    const prefer = req.headers.prefer || "";
    const accept = req.headers.accept || "";
    const args = [];
    let rows = [];
    if (path.startsWith("rpc/")) {
      const keys = Object.keys(body || {});
      rows = (await db.query(`select * from public.${ident(path.slice(4))}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(",")})`, keys.map((k) => body[k]))).rows;
    } else if (req.method === "GET") {
      const sel = url.searchParams.get("select") || "*";
      let sql = `select ${sel === "*" ? "*" : sel.split(",").map(ident).join(",")} from public.${ident(path)}` + where(params, args);
      const order = url.searchParams.get("order");
      if (order) sql += " order by " + order.split(",").map((o) => { const [c, d] = o.split("."); return ident(c) + (d === "desc" ? " desc" : ""); }).join(",");
      if (url.searchParams.get("limit")) sql += " limit " + parseInt(url.searchParams.get("limit"));
      rows = (await db.query(sql, args)).rows;
    } else if (req.method === "POST") {
      const list = Array.isArray(body) ? body : [body];
      const keys = [...new Set(list.flatMap((r) => Object.keys(r)))];
      const vals = list.map((r) => "(" + keys.map((k) => { args.push(r[k] ?? null); return `$${args.length}`; }).join(",") + ")").join(",");
      let sql = `insert into public.${ident(path)} (${keys.map(ident).join(",")}) values ${vals}`;
      const conflict = url.searchParams.get("on_conflict");
      if (prefer.includes("ignore-duplicates")) sql += ` on conflict${conflict ? ` (${conflict.split(",").map(ident).join(",")})` : ""} do nothing`;
      else if (prefer.includes("merge-duplicates") && conflict)
        sql += ` on conflict (${conflict.split(",").map(ident).join(",")}) do update set ` + keys.filter((k) => !conflict.split(",").includes(k)).map((k) => `${ident(k)} = excluded.${ident(k)}`).join(",");
      rows = (await db.query(sql + " returning *", args)).rows;
    } else if (req.method === "PATCH") {
      const keys = Object.keys(body);
      const set = keys.map((k) => { args.push(body[k]); return `${ident(k)} = $${args.length}`; }).join(",");
      rows = (await db.query(`update public.${ident(path)} set ${set}` + where(params, args) + " returning *", args)).rows;
    } else if (req.method === "DELETE") {
      rows = (await db.query(`delete from public.${ident(path)}` + where(params, args) + " returning *", args)).rows;
    }
    if (accept.includes("vnd.pgrst.object")) {
      if (rows.length === 0 && req.method === "GET") return send(res, 406, { message: "no rows", code: "PGRST116" });
      return send(res, 200, rows[0] ?? null);
    }
    return send(res, 200, rows);
  } catch (e) {
    return send(res, 400, { message: e.message, code: e.code });
  }
}).listen(54321, () => console.log("mock supabase on :54321"));
