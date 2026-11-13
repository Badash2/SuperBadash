import { listAddRecipients, ranOutEachRecipients } from "@/lib/notify-rules";
import {
  admin,
  callerEmail,
  loadFamily,
  DbError,
  NotConfigured,
  sendOnce,
} from "@/lib/server/notify";
import { displayName } from "@/lib/text";

/**
 * A family member did something that may interest the others: added to the list / scanned at the bin.
 * The client sends { type, id } with its Supabase token; the server checks the row really belongs to it and is recent,
 * and sends to whoever chose to get this kind of notification.
 */
const MAX_AGE_MS = 10 * 60 * 1000;

export async function POST(req: Request) {
  try {
    const db = admin();
    const actor = await callerEmail(db, req);
    if (!actor)
      return Response.json({ error: "unauthorized" }, { status: 401 });
    const { type, id } = (await req.json()) as { type: string; id: string };
    const fam = await loadFamily(db);
    const name = (e: string | null) =>
      e ? (fam.names.get(e.toLowerCase()) ?? e.split("@")[0]) : "סורק הפח";
    const now = new Date();
    let sent = 0;

    if (type === "list_add") {
      const { data: it } = await db
        .from("shopping_items")
        .select("id,name,added_by,added_at")
        .eq("id", id)
        .maybeSingle();
      if (
        !it ||
        it.added_by.toLowerCase() !== actor.toLowerCase() ||
        now.getTime() - new Date(it.added_at).getTime() > MAX_AGE_MS
      )
        return Response.json({ error: "not found" }, { status: 404 });
      const { data: status } = await db
        .from("member_status")
        .select("email,current_store,updated_at");
      for (const to of listAddRecipients(
        fam.members,
        fam.prefs,
        status ?? [],
        actor,
        now,
      )) {
        sent += await sendOnce(db, to, "list_add", it.id, {
          title: `נוסף לרשימה: ${displayName(it.name)}`,
          body: `${name(actor)} הוסיפו עכשיו`,
          tag: "list",
          url: "/",
        });
      }
    } else if (type === "ran_out") {
      const { data: r } = await db
        .from("consumed_items")
        .select("id,name,scanned_by,scanned_as,scanned_at")
        .eq("id", id)
        .maybeSingle();
      if (
        !r ||
        r.scanned_by.toLowerCase() !== actor.toLowerCase() ||
        now.getTime() - new Date(r.scanned_at).getTime() > MAX_AGE_MS
      )
        return Response.json({ error: "not found" }, { status: 404 });
      for (const to of ranOutEachRecipients(
        fam.members,
        fam.prefs,
        r.scanned_as,
        now,
      )) {
        sent += await sendOnce(db, to, "ran_out", r.id, {
          title: `נגמר: ${displayName(r.name)}`,
          body: r.scanned_as
            ? `נסרק על ידי ${name(r.scanned_as)}`
            : "נסרק ליד הפח",
          tag: "ranout",
          url: "/?tab=ranout",
        });
      }
    } else {
      return Response.json({ error: "unknown type" }, { status: 400 });
    }
    return Response.json({ ok: true, sent });
  } catch (e) {
    if (e instanceof DbError)
      return Response.json({ error: "db", detail: e.message }, { status: 500 });
    if (e instanceof NotConfigured)
      return Response.json({ error: e.message }, { status: 503 });
    console.error(e);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
