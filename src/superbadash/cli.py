"""Command line: superbadash <command>

  ingest     download and store the latest prices and promotions (for scheduled runs)
  deals      deals report: real / meh / fake
  compare    compare a product's price across stores (name or barcode)
  discover   list a chain's branches in a city (to find a store_id)
  status     data status: when each store was last updated
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from .db import DB
from .deals import analyse, compare
from .ingest import DEFAULT_CONFIG, load_stores, run
from .parse import parse_stores
from .sources import CHAINS, client_for

FLAG_HE = {
    "price_raised": "המחיר הרגיל הועלה לפני המבצע",
    "evergreen": "רץ כבר חודשים = זה המחיר האמיתי, אין סיבה להצטייד",
    "cheaper_elsewhere": "זול יותר בסניף אחר",
    "club_only": "למועדון בלבד",
    "coupon": "קופון",
    "check_terms": "הנחה חריגה - לבדוק תנאים",
}
VERDICT_HE = {"real": "✅ אמיתי", "conditional": "🎟 מותנה", "permanent": "♾ מבצע קבוע", "meh": "➖ בינוני", "fake": "❌ מזויף"}


def _flag_he(f: str) -> str:
    if f.startswith("multi_buy_"):
        return f"קנייה מרובה ({f.rsplit('_', 1)[1]})"
    if f.startswith("min_purchase_"):
        return f"מינימום קנייה ₪{f.rsplit('_', 1)[1]}"
    return FLAG_HE.get(f, f)


def cmd_ingest(a) -> int:
    stores = load_stores(a.config)
    if a.stores:
        stores = [s for s in stores if s.key in a.stores.split(",")]
    db = DB(a.db)
    kinds = tuple(k.strip() for k in a.kinds.split(","))
    report = run(db, stores, kinds, force=a.force)
    for r in report:
        extra = {k: v for k, v in r.items() if k not in ("store", "kind", "status", "file")}
        print(f"{r['status']:<10} {r['store']:<30} {r['kind']:<10} {r.get('file', '')} {extra or ''}")
    db.close()
    errors = sum(1 for r in report if r["status"] == "error")
    return 1 if errors == len(report) else 0  # fail only if everything failed


def cmd_deals(a) -> int:
    db = DB(a.db)
    names = {r["store_key"]: r["name"] for r in db.query("SELECT store_key, name FROM stores")}
    deals = analyse(db)
    counts = {v: sum(1 for d in deals if d.verdict == v) for v in ("real", "conditional", "permanent", "meh", "fake")}
    if a.verdict != "all":
        deals = [d for d in deals if d.verdict == a.verdict]
    if a.store:
        deals = [d for d in deals if d.store_key == a.store]
    if a.json:
        json.dump([d.to_dict() for d in deals[: a.top]], sys.stdout, ensure_ascii=False, indent=1)
        print()
        return 0
    for d in deals[: a.top]:
        flags = ", ".join(_flag_he(f) for f in d.flags)
        other = f" | הכי זול אחר: {names.get(d.best_other_store, d.best_other_store)} ₪{d.best_other_price:.2f}" \
            if d.best_other_store else ""
        print(f"{VERDICT_HE[d.verdict]}  {d.name}  [{names.get(d.store_key, d.store_key)}]\n"
              f"    {d.description}\n"
              f"    רגיל ₪{d.regular_price:.2f} → במבצע ₪{d.promo_unit_price:.2f} ליחידה "
              f"({d.discount_pct:.0f}% הנחה, {d.market_saving_pct:.0f}% מול השוק){other}"
              + (f"\n    ⚠ {flags}" if flags else ""))
    print(f"\nסה\"כ בכל הסניפים: {counts['real']} אמיתיים, {counts['conditional']} מותנים, {counts['permanent']} קבועים, {counts['meh']} בינוניים, {counts['fake']} מזויפים (מחיר הועלה לפני המבצע)")
    db.close()
    return 0


def cmd_compare(a) -> int:
    db = DB(a.db)
    names = {r["store_key"]: r["name"] for r in db.query("SELECT store_key, name FROM stores")}
    for p in compare(db, a.query, a.limit):
        print(f"{p['name']} ({p['manufacturer'] or '-'}) [{p['code']}]")
        rows = sorted(p["prices"].items(), key=lambda kv: kv[1]["promo"] or kv[1]["regular"])
        for sk, pr in rows:
            promo = f"  במבצע ₪{pr['promo']:.2f}" if pr["promo"] else ""
            print(f"    ₪{pr['regular']:>7.2f}{promo}   {names.get(sk, sk)}")
    db.close()
    return 0


def cmd_discover(a) -> int:
    chain = CHAINS[a.chain]
    client = client_for(chain)
    name = client.latest("Stores", "0")
    if not name:
        print("no Stores file found", file=sys.stderr)
        return 1
    for s in parse_stores(client.download(name)):
        if (a.city and (s.city == a.city or a.city in s.name or a.city in s.address)) or not a.city:
            print(f"{s.store_id:>5}  {s.name}  |  {s.address}  (city={s.city})")
    return 0


def cmd_status(a) -> int:
    db = DB(a.db)
    db.init_schema()
    for r in db.query("""SELECT store_key, kind, MAX(ingested_at) AS last, COUNT(*) AS runs
                         FROM ingest_runs GROUP BY store_key, kind ORDER BY store_key, kind"""):
        print(f"{r['store_key']:<30} {r['kind']:<10} last={r['last']} runs={r['runs']}")
    for t in ("products", "current_prices", "price_changes", "promotions", "promo_items"):
        print(f"{t:<16} {db.query(f'SELECT COUNT(*) AS n FROM {t}')[0]['n']}")
    db.close()
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="superbadash", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", help="DATABASE_URL (default: env DATABASE_URL or sqlite:///data/superbadash.sqlite)")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("ingest")
    s.add_argument("--config", default=str(DEFAULT_CONFIG))
    s.add_argument("--stores", help="comma-separated store keys (default: all enabled)")
    s.add_argument("--kinds", default="PriceFull,PromoFull")
    s.add_argument("--force", action="store_true", help="re-process even if the file was already ingested")
    s.set_defaults(fn=cmd_ingest)

    s = sub.add_parser("deals")
    s.add_argument("--verdict", choices=["real", "conditional", "permanent", "meh", "fake", "all"], default="real")
    s.add_argument("--store")
    s.add_argument("--top", type=int, default=30)
    s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_deals)

    s = sub.add_parser("compare")
    s.add_argument("query")
    s.add_argument("--limit", type=int, default=10)
    s.set_defaults(fn=cmd_compare)

    s = sub.add_parser("discover")
    s.add_argument("chain", choices=sorted(CHAINS))
    s.add_argument("--city", help="CBS city code (Netanya=7400) or part of the name")
    s.set_defaults(fn=cmd_discover)

    s = sub.add_parser("status")
    s.set_defaults(fn=cmd_status)

    a = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO if a.verbose else logging.WARNING,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
