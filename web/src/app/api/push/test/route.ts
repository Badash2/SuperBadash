import {
  admin,
  callerEmail,
  NotConfigured,
  sendOnce,
} from "@/lib/server/notify";

/** A test notification to the caller's own devices (the "send a test" button in Settings). */
export async function POST(req: Request) {
  try {
    const db = admin();
    const email = await callerEmail(db, req);
    if (!email)
      return Response.json({ error: "unauthorized" }, { status: 401 });
    const sent = await sendOnce(db, email, "test", String(Date.now()), {
      title: "🛒 SuperBadash",
      body: "ההתראות עובדות במכשיר הזה ✓",
      tag: "test",
    });
    return Response.json({ ok: true, sent });
  } catch (e) {
    if (e instanceof NotConfigured)
      return Response.json({ error: e.message }, { status: 503 });
    console.error(e);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
