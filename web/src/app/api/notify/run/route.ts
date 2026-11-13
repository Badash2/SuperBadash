import {
  dealRef,
  isDigestHour,
  isQuietHour,
  israelClock,
  prefsFor,
  ranOutSourceAllowed,
  relevantDeals,
  type DealLite,
} from "@/lib/notify-rules";
import {
  admin,
  loadFamily,
  markSent,
  DbError,
  NotConfigured,
  ourProducts,
  sendOnce,
} from "@/lib/server/notify";
import { storeShort } from "@/lib/stores";
import { displayName } from "@/lib/text";

/**
 * A periodic run (every hour from GitHub Actions, and after every price update):
 *  - daily digests ("ran out today", "deals on what you buy") at each person's chosen hour
 *  - "every real deal": new deals on our products since the last notification
 * No secret is needed to trigger it: it is idempotent (notification_log prevents a double send), so a duplicate trigger is harmless.
 */
const MAX_EACH_DEALS_PER_RUN = 3;

const shekel = (n: number) => `₪${n.toFixed(2)}`;

export async function POST() {
  try {
    const db = admin();
    const now = new Date();
    const { date } = israelClock(now);
    const fam = await loadFamily(db);
    const report: Record<string, number> = {
      ranout_daily: 0,
      deals_daily: 0,
      deals_each: 0,
    };

    const anyDeals = fam.members.some(
      (m) => prefsFor(m, fam.prefs).deals !== "off",
    );
    let deals: DealLite[] = [];
    let ours = new Map<string, number>();
    const names = new Map<string, string>();
    if (anyDeals) {
      const [d, o] = await Promise.all([
        db
          .from("deals")
          .select(
            "store_key,code,promo_id,verdict,market_saving_pct,promo_unit_price,regular_price,description",
          )
          .eq("verdict", "real"),
        ourProducts(db),
      ]);
      if (d.error) throw new DbError(`deals: ${d.error.message}`);
      deals = (d.data ?? []) as DealLite[];
      ours = o;
      const codes = [
        ...new Set(deals.filter((x) => ours.has(x.code)).map((x) => x.code)),
      ].slice(0, 300);
      if (codes.length) {
        const { data: p } = await db
          .from("products")
          .select("code,name")
          .in("code", codes);
        for (const r of (p ?? []) as { code: string; name: string }[])
          names.set(r.code, displayName(r.name));
      }
    }
    const nameOf = (d: DealLite) =>
      names.get(d.code) ?? displayName(d.description ?? d.code);

    const since24h = new Date(now.getTime() - 24 * 3600000).toISOString();
    const { data: scans, error: scansError } = await db
      .from("consumed_items")
      .select("name,scanned_as,scanned_at")
      .gte("scanned_at", since24h);
    if (scansError) throw new DbError(`consumed_items: ${scansError.message}`);

    for (const email of fam.members) {
      const p = prefsFor(email, fam.prefs);

      // --- daily digest: ran out ---
      if (p.ran_out === "daily" && isDigestHour(p, now)) {
        const mine = [
          ...new Set(
            ((scans ?? []) as { name: string; scanned_as: string | null }[])
              .filter((s) => ranOutSourceAllowed(p, s.scanned_as))
              .map((s) => displayName(s.name)),
          ),
        ];
        if (mine.length) {
          report.ranout_daily += await sendOnce(
            db,
            email,
            "ranout_daily",
            date,
            {
              title: `נגמרו היום ${mine.length} מוצרים`,
              body:
                mine.slice(0, 4).join(", ") +
                (mine.length > 4 ? ` ועוד ${mine.length - 4}` : ""),
              tag: "ranout-daily",
              url: "/?tab=ranout",
            },
          );
        }
      }

      if (p.deals === "off" || deals.length === 0) continue;
      const relevant = relevantDeals(deals, ours, p.deals_scope);

      // --- daily digest: deals ---
      if (p.deals === "daily" && isDigestHour(p, now) && relevant.length) {
        const top = relevant
          .slice(0, 3)
          .map(
            (d) =>
              `${nameOf(d)} ${shekel(d.promo_unit_price)} ב${storeShort(d.store_key)}`,
          );
        report.deals_daily += await sendOnce(db, email, "deals_daily", date, {
          title: `${relevant.length} מבצעים אמיתיים על מה שאתם קונים`,
          body: top.join(" · "),
          tag: "deals-daily",
          url: "/?tab=deals",
        });
      }

      // --- every real deal (new) ---
      if (p.deals === "each") {
        const { data: base } = await db
          .from("notification_log")
          .select("ref")
          .eq("email", email)
          .eq("kind", "deal_baseline")
          .limit(1);
        if (!base || base.length === 0) {
          // First time: record the existing deals without sending, so we don't bombard - from now on only new ones
          await markSent(db, [
            { email, kind: "deal_baseline", ref: date },
            ...relevant.map((d) => ({ email, kind: "deal", ref: dealRef(d) })),
          ]);
          continue;
        }
        if (p.quiet && isQuietHour(now)) continue;
        let n = 0;
        for (const d of relevant) {
          if (n >= MAX_EACH_DEALS_PER_RUN) break;
          const got = await sendOnce(db, email, "deal", dealRef(d), {
            title: `🔥 ${nameOf(d)} ב${storeShort(d.store_key)}`,
            body: `${shekel(d.promo_unit_price)} במקום ${shekel(d.regular_price)} (−${Math.round(d.market_saving_pct)}% מול השוק)`,
            tag: `deal-${d.code}`,
            url: "/?tab=deals",
          });
          if (got) n++;
          report.deals_each += got;
        }
      }
    }
    return Response.json({ ok: true, at: now.toISOString(), ...report });
  } catch (e) {
    if (e instanceof DbError)
      return Response.json({ error: "db", detail: e.message }, { status: 500 });
    if (e instanceof NotConfigured)
      return Response.json({ error: e.message }, { status: 503 });
    console.error(e);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
