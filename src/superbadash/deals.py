"""Analysing promotions: which are real, which are marketing.

The principle: a promotion's "discount" is measured against the price the chain
chose to show as regular, and that is not a reliable reference. So every
promotion is checked against:

1. The item's regular price in the same store (a promotion with no lower price in
   the file is not analysed at all: it is missing data, not evidence of a fake).
2. History: was the regular price raised shortly before the promotion?
   (`price_raised`, the classic fake promotion.)
3. Duration: a promotion running for months is the real price, not an opportunity
   (`evergreen` -> verdict `permanent`: fine to buy, no reason to stock up).
4. The market: the same barcode in the other stores we track. If another store
   sells it at this price or lower without a promotion, the promotion isn't
   interesting (`cheaper_elsewhere`).
5. Terms: club/coupon/minimum spend/multi-buy are marked, so we know what it
   takes to actually get the price.
"""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone

from .db import DB

EVERGREEN_DAYS = 120
RAISE_LOOKBACK_DAYS = 60
MIN_REAL_DISCOUNT = 0.10


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts).replace(tzinfo=None)
    except ValueError:
        return None


MIN_PURCHASE_RE = re.compile(r"מות\s?(\d{2,4})")
SPEND_THRESHOLD_QTY = 100  # a MinQty above this on a non-weighed item = spend amount in agorot, not a quantity


def promo_unit_price(regular: float, min_qty: float | None, discounted_price: float | None,
                     discount_rate: float | None, reward_type: int | None = None,
                     is_weighted: bool = False) -> float | None:
    """Effective price per unit (or per kg for weighed items).

    Rules verified against the real data of all four chains (11/2026):
    * Bundle ("3 for 10"): DiscountedPrice=10, MinQty=3 -> 10/3 per unit.
    * "Second at half price" (RewardType=2, MinQty>=2): DiscountedPrice is the price of the
      discounted item only -> (regular*(n-1) + DiscountedPrice) / n.
    * Weighed with MinQty=0.01 (Osher Ad, Yochananof): a sentinel, DiscountedPrice is the per-kg price.
    * Weighed with a real weight ("300g for 22", MinQty=0.3): divide by the weight.
    * DiscountedPrice=0: gift/coupon with no shelf price -> None.
    """
    dp = discounted_price
    if dp is None or dp <= 0:
        if discount_rate and 0 < discount_rate < 100:
            return round(regular * (1 - discount_rate / 100), 3)
        return None
    q = min_qty or 1.0
    if q >= 1:
        if reward_type == 2 and q >= 2 and dp < regular:
            return round((regular * (q - 1) + dp) / q, 3)
        return round(dp / q, 3)
    if is_weighted and q >= 0.05:
        per_kg = dp / q
        if per_kg <= regular * 1.05:
            return round(per_kg, 3)
    return round(dp, 3)


@dataclass
class Deal:
    store_key: str
    code: str
    barcode: str | None
    name: str
    promo_id: str
    description: str
    regular_price: float
    promo_unit_price: float
    min_qty: float | None
    discount_pct: float
    market_reference: float
    market_saving_pct: float
    best_other_store: str | None = None
    best_other_price: float | None = None
    start_at: str | None = None
    end_at: str | None = None
    flags: list[str] = field(default_factory=list)
    verdict: str = "meh"  # real | conditional | permanent | meh | fake

    def to_dict(self) -> dict:
        return asdict(self)


def _latest_promo_snapshot(db: DB) -> dict[str, str]:
    return {r["store_key"]: r["ts"] for r in db.query(
        "SELECT store_key, MAX(last_seen) AS ts FROM promotions GROUP BY store_key")}


def _latest_price_snapshot(db: DB) -> dict[str, str]:
    return {r["store_key"]: r["ts"] for r in db.query(
        "SELECT store_key, MAX(last_seen) AS ts FROM current_prices GROUP BY store_key")}


def active_promo_rows(db: DB, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc).replace(tzinfo=None)
    snap = _latest_promo_snapshot(db)
    rows = db.query("""
        SELECT pi.store_key, pi.promo_id, pi.code, pi.min_qty, pi.discounted_price, pi.discount_rate, pi.reward_type,
               p.description, p.start_at, p.end_at, p.club_id, p.is_coupon, p.is_gift, p.min_purchase,
               p.first_seen, p.last_seen, cp.price AS regular_price,
               pr.name, pr.barcode, pr.is_weighted
        FROM promo_items pi
        JOIN promotions p ON p.store_key = pi.store_key AND p.promo_id = pi.promo_id
        JOIN current_prices cp ON cp.store_key = pi.store_key AND cp.code = pi.code
        JOIN products pr ON pr.code = pi.code
    """)
    out = []
    for r in rows:
        if r["last_seen"] != snap.get(r["store_key"]):
            continue  # the promotion is gone from the latest file
        start, end = _parse(r["start_at"]), _parse(r["end_at"])
        if (start and start > now) or (end and end < now):
            continue
        out.append(r)
    return out


def market_prices(db: DB) -> dict[str, dict[str, float]]:
    """{barcode: {store_key: regular price}}, from the latest snapshot only."""
    snap = _latest_price_snapshot(db)
    out: dict[str, dict[str, float]] = {}
    for r in db.query("""
        SELECT cp.store_key, cp.code, cp.price, cp.last_seen FROM current_prices cp
        JOIN products pr ON pr.code = cp.code WHERE pr.barcode IS NOT NULL
    """):
        if r["last_seen"] == snap.get(r["store_key"]):
            out.setdefault(r["code"], {})[r["store_key"]] = r["price"]
    return out


def recent_raises(db: DB, since: datetime) -> dict[tuple[str, str], list[datetime]]:
    """{(store, product): [dates the regular price went up]} since `since`."""
    rows = db.query("""SELECT store_key, code, changed_at FROM price_changes
                       WHERE old_price IS NOT NULL AND new_price > old_price + 0.001 AND changed_at >= ?""",
                    (since.strftime("%Y-%m-%dT%H:%M:%S"),))
    out: dict[tuple[str, str], list[datetime]] = {}
    for r in rows:
        t = _parse(r["changed_at"])
        if t:
            out.setdefault((r["store_key"], r["code"]), []).append(t)
    return out


def analyse(db: DB, now: datetime | None = None) -> list[Deal]:
    now = now or datetime.now(timezone.utc).replace(tzinfo=None)
    rows = active_promo_rows(db, now)
    market = market_prices(db)
    raises = recent_raises(db, now - timedelta(days=RAISE_LOOKBACK_DAYS + EVERGREEN_DAYS))  # covers every relevant window

    # The best promo price per (store, product) - for the cross-store comparison
    best_promo: dict[tuple[str, str], float] = {}
    for r in rows:
        if r["club_id"] not in (0, None) or r["is_coupon"]:
            continue
        u = promo_unit_price(r["regular_price"], r["min_qty"], r["discounted_price"], r["discount_rate"],
                             r["reward_type"], bool(r["is_weighted"]))
        if r["min_qty"] and r["min_qty"] > SPEND_THRESHOLD_QTY and not r["is_weighted"]:
            continue
        if u is not None and u < r["regular_price"]:
            k = (r["store_key"], r["code"])
            best_promo[k] = min(best_promo.get(k, u), u)

    deals: dict[tuple[str, str], Deal] = {}
    for r in rows:
        regular = r["regular_price"]
        if r["is_gift"] or not regular or regular <= 0:
            continue
        if r["min_qty"] and r["min_qty"] > SPEND_THRESHOLD_QTY and not r["is_weighted"]:
            continue  # "spend 59.90, get a gift" - not a product price
        unit = promo_unit_price(regular, r["min_qty"], r["discounted_price"], r["discount_rate"],
                                r["reward_type"], bool(r["is_weighted"]))
        if unit is None or unit >= regular - 0.005:
            # The file doesn't encode a lower price (common with coupons and "second at 50%" where the
            # chain only filled in the shelf price). Nothing to analyse - this is NOT evidence of a fake.
            continue
        flags: list[str] = []
        if r["club_id"] not in (0, None):
            flags.append("club_only")
        if r["is_coupon"]:
            flags.append("coupon")
        # Minimum spend: from the field, or from the description ("...-מות100" = conditional on buying 100 ILS)
        min_purchase = r["min_purchase"]
        if not min_purchase:
            m = MIN_PURCHASE_RE.search(r["description"] or "")
            min_purchase = float(m.group(1)) if m else None
        if min_purchase:
            flags.append(f"min_purchase_{min_purchase:g}")
        if r["min_qty"] and r["min_qty"] > 1 and not r["is_weighted"]:
            flags.append(f"multi_buy_{r['min_qty']:g}")
        if unit < regular * 0.25:
            flags.append("check_terms")  # discount over 75% - usually a coupon/condition hidden in the text
        start = _parse(r["start_at"])
        if start and (now - start).days > EVERGREEN_DAYS:
            flags.append("evergreen")
        # Price raised within the window before the promotion started -> the "discount" is inflated
        promo_start = start or _parse(r["first_seen"]) or now
        for t in raises.get((r["store_key"], r["code"]), []):
            if promo_start - timedelta(days=RAISE_LOOKBACK_DAYS) <= t <= promo_start + timedelta(days=1):
                flags.append("price_raised")
                break

        # Market comparison (barcoded products only)
        reference = regular
        best_store, best_price = None, None
        if r["barcode"] and r["code"] in market:
            # Filter unit mismatches (same barcode sold per pack in one chain and per kg in another)
            comparable = {s: p for s, p in market[r["code"]].items() if regular / 3 <= p <= regular * 3}
            others = {s: min(p, best_promo.get((s, r["code"]), p))
                      for s, p in comparable.items() if s != r["store_key"]}
            all_regular = list(comparable.values()) or [regular]
            reference = statistics.median(all_regular)
            if others:
                best_store = min(others, key=others.get)
                best_price = others[best_store]
                if best_price <= unit + 0.005:
                    flags.append("cheaper_elsewhere")

        discount = 1 - unit / regular
        market_saving = 1 - unit / reference if reference > 0 else 0.0
        if "price_raised" in flags:
            verdict = "fake"  # the regular price was raised before the promotion - an inflated discount
        elif {"coupon", "club_only", "check_terms"} & set(flags) or any(f.startswith("min_purchase_") for f in flags):
            verdict = "conditional"  # a real price but with a condition (coupon/club/hidden terms)
        elif "evergreen" in flags:
            verdict = "permanent"  # runs for months = the real price. Fine to buy, no reason to stock up
        elif discount >= MIN_REAL_DISCOUNT and market_saving >= MIN_REAL_DISCOUNT * 0.5 \
                and not {"cheaper_elsewhere", "check_terms"} & set(flags):
            verdict = "real"
        else:
            verdict = "meh"

        d = Deal(store_key=r["store_key"], code=r["code"], barcode=r["barcode"], name=r["name"],
                 promo_id=r["promo_id"], description=r["description"] or "", regular_price=regular,
                 promo_unit_price=unit, min_qty=r["min_qty"], discount_pct=round(discount * 100, 1),
                 market_reference=round(reference, 2), market_saving_pct=round(market_saving * 100, 1),
                 best_other_store=best_store, best_other_price=best_price,
                 start_at=r["start_at"], end_at=r["end_at"], flags=flags, verdict=verdict)
        # Several promos on the same product at the same store: keep the cheapest
        k = (d.store_key, d.code)
        if k not in deals or d.promo_unit_price < deals[k].promo_unit_price:
            deals[k] = d

    order = {"real": 0, "conditional": 1, "permanent": 2, "meh": 3, "fake": 4}
    return sorted(deals.values(), key=lambda d: (order[d.verdict], -d.market_saving_pct))


def compare(db: DB, query: str, limit: int = 20) -> list[dict]:
    """Search for a product by name or barcode and compare its price across all stores."""
    snap = _latest_price_snapshot(db)
    q = query.strip()
    if q.isdigit():
        prods = db.query("SELECT code, name, manufacturer FROM products WHERE barcode = ? OR code = ?",
                         (q.lstrip("0"), q))
    else:
        terms = q.split()
        where = " AND ".join(["name LIKE ?"] * len(terms))
        prods = db.query(f"SELECT code, name, manufacturer FROM products WHERE barcode IS NOT NULL AND {where} "
                         f"ORDER BY name LIMIT {int(limit)}", [f"%{t}%" for t in terms])
    promos: dict[tuple[str, str], float] = {}
    for d in analyse(db):
        if not ({"club_only", "coupon", "check_terms"} & set(d.flags)):
            promos[(d.store_key, d.code)] = d.promo_unit_price
    out = []
    for p in prods:
        prices = {}
        for r in db.query("SELECT store_key, price, last_seen FROM current_prices WHERE code = ?", (p["code"],)):
            if r["last_seen"] == snap.get(r["store_key"]):
                prices[r["store_key"]] = {"regular": r["price"], "promo": promos.get((r["store_key"], p["code"]))}
        out.append({**p, "prices": prices})
    return out


def publish(db: DB, now: datetime | None = None) -> int:
    """Write the analysis to the `deals` table, which the site reads. Replaces the whole snapshot."""
    deals = analyse(db, now)
    ts = (now or datetime.now(timezone.utc).replace(tzinfo=None)).strftime("%Y-%m-%dT%H:%M:%S")
    rows = [(d.store_key, d.code, d.promo_id, d.description, d.regular_price, d.promo_unit_price, d.min_qty,
             d.discount_pct, d.market_saving_pct, d.verdict, ",".join(d.flags), d.end_at, ts) for d in deals]
    with db.transaction():
        db.execute("DELETE FROM deals")
        db.executemany("""INSERT INTO deals (store_key, code, promo_id, description, regular_price, promo_unit_price,
                          min_qty, discount_pct, market_saving_pct, verdict, flags, end_at, computed_at)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""", rows)
    return len(rows)
