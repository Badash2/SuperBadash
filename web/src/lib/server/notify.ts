import "server-only";
import webpush from "web-push";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Prefs } from "@/lib/notify-rules";

/**
 * The server side of notifications. Needs two secrets in the Vercel environment variables:
 *   SUPABASE_SECRET_KEY  - the Supabase secret key (to read every member's settings and devices)
 *   VAPID_PRIVATE_KEY    - the private key for signing Web Push
 */
export const VAPID_PUBLIC_KEY =
  "BFeQ0md5IPFtcpU2oq0Z-ZSBjhYXBabYduJ8v4knCnk5lQwt2xQPRtNqHtw8UrE5hPacspSGacdYqypvDPGjDaM";
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://hzyqvkqkozabwhhpxngy.supabase.co";
const SITE = "https://super-badash.vercel.app";

export class NotConfigured extends Error {}

export function admin(): SupabaseClient {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new NotConfigured("SUPABASE_SECRET_KEY is not set in Vercel");
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let vapidReady = false;
function ensureVapid() {
  if (vapidReady) return;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!priv) throw new NotConfigured("VAPID_PRIVATE_KEY is not set in Vercel");
  webpush.setVapidDetails(SITE, VAPID_PUBLIC_KEY, priv);
  vapidReady = true;
}

/** Identify the caller by the Supabase token they send, and check they are a family member. */
export async function callerEmail(
  db: SupabaseClient,
  req: Request,
): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  const email = data.user?.email;
  if (!email) return null;
  const { data: fm } = await db
    .from("family_members")
    .select("email")
    .ilike("email", email);
  return fm && fm.length ? email : null;
}

export type Family = {
  members: string[];
  names: Map<string, string>;
  prefs: Prefs[];
};

export async function loadFamily(db: SupabaseClient): Promise<Family> {
  const [m, p] = await Promise.all([
    db.from("family_members").select("email,display_name"),
    db.from("notification_prefs").select("*"),
  ]);
  const rows = (m.data ?? []) as {
    email: string;
    display_name: string | null;
  }[];
  return {
    members: rows.map((r) => r.email),
    names: new Map(
      rows.map((r) => [
        r.email.toLowerCase(),
        r.display_name || r.email.split("@")[0],
      ]),
    ),
    prefs: (p.data ?? []) as Prefs[],
  };
}

export type Payload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

/**
 * Send to a single user, at most once per (kind, ref): a notification_log row is inserted first,
 * and sending happens only if it is new. So a double trigger never sends twice.
 */
export async function sendOnce(
  db: SupabaseClient,
  email: string,
  kind: string,
  ref: string,
  payload: Payload,
): Promise<number> {
  ensureVapid();
  const { data: fresh } = await db
    .from("notification_log")
    .upsert(
      { email, kind, ref },
      { onConflict: "email,kind,ref", ignoreDuplicates: true },
    )
    .select("email");
  if (!fresh || fresh.length === 0) return 0; // already sent

  const { data: subs } = await db
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth,failures")
    .ilike("email", email);
  let sent = 0;
  const body = JSON.stringify({ url: "/", ...payload });
  for (const s of (subs ?? []) as {
    endpoint: string;
    p256dh: string;
    auth: string;
    failures: number;
  }[]) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        {
          TTL: 6 * 3600,
          urgency: kind === "list_add" ? "high" : "normal",
        },
      );
      sent++;
      await db
        .from("push_subscriptions")
        .update({ last_ok_at: new Date().toISOString(), failures: 0 })
        .eq("endpoint", s.endpoint);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410 || s.failures >= 5) {
        await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint); // the device unsubscribed / the app was removed
      } else {
        await db
          .from("push_subscriptions")
          .update({ failures: s.failures + 1 })
          .eq("endpoint", s.endpoint);
      }
    }
  }
  return sent;
}

/** Record without sending (e.g. a baseline of the existing deals the first time someone picks "every deal"). */
export async function markSent(
  db: SupabaseClient,
  rows: { email: string; kind: string; ref: string }[],
) {
  if (rows.length)
    await db
      .from("notification_log")
      .upsert(rows, { onConflict: "email,kind,ref", ignoreDuplicates: true });
}

/** "Our products": what was bought, ran out, or is on the list - with a weight for how often it repeats. */
export async function ourProducts(
  db: SupabaseClient,
): Promise<Map<string, number>> {
  const since = new Date(Date.now() - 180 * 86400000).toISOString();
  const [p, c, s] = await Promise.all([
    db
      .from("purchases")
      .select("code")
      .not("code", "is", null)
      .gte("purchased_at", since),
    db.from("consumed_items").select("code").gte("scanned_at", since),
    db.from("shopping_items").select("code").not("code", "is", null),
  ]);
  const w = new Map<string, number>();
  for (const r of [...(p.data ?? []), ...(c.data ?? []), ...(s.data ?? [])] as {
    code: string;
  }[]) {
    w.set(r.code, (w.get(r.code) ?? 0) + 1);
  }
  return w;
}
