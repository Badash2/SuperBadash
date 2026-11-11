"""Price and promotion ingestion: download -> parse -> store, recording changes only."""

from __future__ import annotations

import logging
import tomllib
from dataclasses import dataclass
from pathlib import Path

from .db import DB, now_iso
from .parse import PriceItem, Promotion, is_global_barcode, parse_prices, parse_promos
from .sources import CHAINS, client_for

log = logging.getLogger(__name__)

def _default_config() -> Path:
    """config/stores.toml from the current directory (non-editable install / CI), or the repo root."""
    cwd = Path.cwd() / "config" / "stores.toml"
    return cwd if cwd.exists() else Path(__file__).resolve().parents[2] / "config" / "stores.toml"


DEFAULT_CONFIG = _default_config()


@dataclass
class StoreConf:
    key: str
    chain: str
    store_id: str
    name: str
    role: str = "primary"
    enabled: bool = True
    confirm: str | None = None


def load_stores(path: Path | str = DEFAULT_CONFIG, include_disabled: bool = False) -> list[StoreConf]:
    with open(path, "rb") as f:
        data = tomllib.load(f)
    stores = [StoreConf(**s) for s in data.get("store", [])]
    for s in stores:
        if s.chain not in CHAINS:
            raise ValueError(f"unknown chain '{s.chain}' in {s.key}")
    return stores if include_disabled else [s for s in stores if s.enabled]


def product_code(chain: str, item_code: str, item_type: int | None) -> tuple[str, str | None]:
    """(product key, barcode). A global barcode is shared across chains; an internal code gets a chain prefix."""
    if is_global_barcode(item_code, item_type):
        # Normalise: barcodes sometimes arrive with leading zeros (UPC-A as EAN-13)
        code = item_code.lstrip("0")
        return code, code
    return f"{chain}:{item_code}", None


def _already(db: DB, store_key: str, kind: str, file_name: str) -> bool:
    return bool(db.query("SELECT 1 AS x FROM ingest_runs WHERE store_key=? AND kind=? AND file_name=?",
                         (store_key, kind, file_name)))


def ingest_prices(db: DB, store: StoreConf, items: list[PriceItem], ts: str | None = None) -> dict:
    ts = ts or now_iso()
    current = {r["code"]: r["price"] for r in db.query(
        "SELECT code, price FROM current_prices WHERE store_key=?", (store.key,))}
    products, prices, changes = [], [], []
    seen: set[str] = set()
    for it in items:
        code, barcode = product_code(store.chain, it.item_code, it.item_type)
        if code in seen:  # duplicate rows in the file: keep the first
            continue
        seen.add(code)
        products.append((code, barcode, it.name, it.manufacturer, it.quantity, it.unit,
                         int(it.is_weighted), ts))
        prices.append((store.key, code, it.price, it.unit_price, ts, ts))
        old = current.get(code)
        if old is None or abs(old - it.price) > 0.001:
            changes.append((store.key, code, ts, old, it.price))

    with db.transaction():
        db.executemany("""
            INSERT INTO products (code, barcode, name, manufacturer, quantity, unit, is_weighted, updated_at)
            VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT (code) DO UPDATE SET
                name=excluded.name, manufacturer=excluded.manufacturer, quantity=excluded.quantity,
                unit=excluded.unit, is_weighted=excluded.is_weighted, updated_at=excluded.updated_at
        """, products)
        db.executemany("""
            INSERT INTO current_prices (store_key, code, price, unit_price, since, last_seen)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT (store_key, code) DO UPDATE SET
                since = CASE WHEN ABS(current_prices.price - excluded.price) > 0.001
                             THEN excluded.since ELSE current_prices.since END,
                price=excluded.price, unit_price=excluded.unit_price, last_seen=excluded.last_seen
        """, prices)
        db.executemany("""
            INSERT INTO price_changes (store_key, code, changed_at, old_price, new_price)
            VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING
        """, changes)
    return {"rows": len(prices), "changes": len(changes), "new": sum(1 for c in changes if c[3] is None)}


def ingest_promos(db: DB, store: StoreConf, promos: list[Promotion], ts: str | None = None) -> dict:
    ts = ts or now_iso()
    headers, items = [], []
    for p in promos:
        headers.append((store.key, p.promo_id, p.description, p.start_at, p.end_at, p.club_id,
                        int(p.is_coupon), int(p.is_gift), int(p.allow_multiple), p.min_purchase,
                        len(p.items), ts, ts))
        seen = set()
        for i in p.items:
            code, _ = product_code(store.chain, i.item_code, i.item_type)
            if code in seen:
                continue
            seen.add(code)
            items.append((store.key, p.promo_id, code, i.min_qty, i.discounted_price,
                          i.discount_rate, i.reward_type))
    with db.transaction():
        db.executemany("""
            INSERT INTO promotions (store_key, promo_id, description, start_at, end_at, club_id, is_coupon,
                                    is_gift, allow_multiple, min_purchase, item_count, first_seen, last_seen)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT (store_key, promo_id) DO UPDATE SET
                description=excluded.description, start_at=excluded.start_at, end_at=excluded.end_at,
                club_id=excluded.club_id, is_coupon=excluded.is_coupon, is_gift=excluded.is_gift,
                allow_multiple=excluded.allow_multiple, min_purchase=excluded.min_purchase,
                item_count=excluded.item_count, last_seen=excluded.last_seen
        """, headers)
        # promo_items reflect the latest snapshot only (the header keeps the history)
        db.execute("DELETE FROM promo_items WHERE store_key=?", (store.key,))
        db.executemany("""
            INSERT INTO promo_items (store_key, promo_id, code, min_qty, discounted_price, discount_rate, reward_type)
            VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING
        """, items)
    return {"rows": len(headers), "items": len(items)}


def run(db: DB, stores: list[StoreConf], kinds: tuple[str, ...] = ("PriceFull", "PromoFull"),
        force: bool = False) -> list[dict]:
    """Ingest the newest files for each store. Returns a summary per store and file type."""
    db.init_schema()
    report = []
    clients: dict[str, object] = {}
    for st in stores:
        db.execute("""INSERT INTO stores (store_key, chain, store_id, name, role) VALUES (?,?,?,?,?)
                      ON CONFLICT (store_key) DO UPDATE SET name=excluded.name, role=excluded.role""",
                   (st.key, st.chain, st.store_id, st.name, st.role))
        db.conn.commit()
        chain = CHAINS[st.chain]
        client = clients.setdefault(st.chain, client_for(chain))
        for kind in kinds:
            entry = {"store": st.key, "kind": kind}
            try:
                name = client.latest(kind, st.store_id)
                if not name:
                    entry["status"] = "no-file"
                elif not force and _already(db, st.key, kind, name):
                    entry.update(status="unchanged", file=name)
                else:
                    raw = client.download(name)
                    ts = now_iso()
                    if kind.startswith("Price"):
                        stats = ingest_prices(db, st, list(parse_prices(raw)), ts)
                    else:
                        stats = ingest_promos(db, st, list(parse_promos(raw)), ts)
                    with db.transaction():
                        db.execute("""INSERT INTO ingest_runs (store_key, kind, file_name, ingested_at, rows, changes)
                                      VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING""",
                                   (st.key, kind, name, ts, stats["rows"], stats.get("changes", 0)))
                    entry.update(status="ok", file=name, **stats)
            except Exception as e:  # one store failing must not stop the others
                log.exception("ingest failed: %s %s", st.key, kind)
                db.conn.rollback()
                entry.update(status="error", error=str(e)[:300])
            log.info("%s", entry)
            report.append(entry)
    return report
