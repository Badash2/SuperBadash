import os
from datetime import datetime
from pathlib import Path

import pytest

from superbadash.db import DB
from superbadash.deals import analyse, compare, promo_unit_price
from superbadash.ingest import StoreConf, ingest_prices, ingest_promos, load_stores, product_code
from superbadash.parse import header, parse_prices, parse_promos
from superbadash.sources import file_timestamp

FX = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 11, 12, 0, 0)
STORE = StoreConf(key="rl", chain="rami-levy", store_id="037", name="רמי לוי")
OTHER = StoreConf(key="yo", chain="yochananof", store_id="030", name="יוחננוף")


def raw(name: str) -> bytes:
    return (FX / name).read_bytes()


# ---------- parsing ----------

def test_parse_prices_utf8_and_utf16_lowercase_tags():
    a = list(parse_prices(raw("PriceFull_sample.xml")))
    b = list(parse_prices(raw("PriceFull_utf16.xml")))
    assert len(a) == len(b) == 5
    bamba = a[0]
    assert (bamba.item_code, bamba.price, bamba.is_weighted) == ("7290000066318", 4.0, False)
    assert bamba.price_update == "2026-11-01T08:00:00"
    assert a[2].is_weighted and a[2].item_type == 0
    assert [x.price for x in a] == [x.price for x in b]


def test_header():
    assert header(raw("PriceFull_sample.xml")) == {"chainid": "7290058140886", "subchainid": "001", "storeid": "037"}


def test_parse_promos():
    promos = {p.promo_id: p for p in parse_promos(raw("PromoFull_sample.xml"))}
    assert set(promos) == {"1", "2", "3", "4", "5"}
    p1 = promos["1"]
    assert p1.club_id == 0 and not p1.is_coupon
    assert p1.items[0].min_qty == 3 and p1.items[0].discounted_price == 10.0


def test_file_timestamp_sorting():
    names = ["PriceFull7290058140886-001-037-20261111-060016.gz",
             "PriceFull7290058140886-001-037-20261111-180011.gz",
             "PriceFull7290058140886-001-037-20261110-235959.gz"]
    assert max(names, key=file_timestamp).endswith("180011.gz")
    assert file_timestamp("PriceFull7290027600007-396-202611110300.gz") > file_timestamp(
        "PriceFull7290027600007-396-202611100300.gz")


# ---------- unit price rules (calibrated on real chain data) ----------

@pytest.mark.parametrize("args,expected", [
    ((3.9, 3, 10.0, None), 3.333),                     # 3 for 10 (bundle)
    ((10.0, 1, 8.9, 11), 8.9),                         # fixed price
    ((12.8, 2, 6.4, 50, 2), 9.6),                      # second at half price (RewardType 2)
    ((15.9, 0.01, 14.9, 6, 3, True), 14.9),            # weighed, MinQty=0.01 sentinel -> per kg
    ((79.0, 0.3, 22.0, None, 1, True), 73.333),        # "300g for 22" -> per kg
    ((26.5, 1, 0.0, 100), None),                       # gift / coupon
    ((20.0, 1, None, 25), 15.0),                       # percent only
])
def test_promo_unit_price(args, expected):
    assert promo_unit_price(*args) == expected


def test_product_code_barcode_vs_internal():
    assert product_code("rami-levy", "7290000066318", 1) == ("7290000066318", "7290000066318")
    assert product_code("rami-levy", "07290000066318", 1) == ("7290000066318", "7290000066318")
    assert product_code("yochananof", "400433", 0) == ("yochananof:400433", None)


def test_stores_config_is_valid():
    stores = load_stores(include_disabled=True)
    keys = [s.key for s in stores]
    assert len(keys) == len(set(keys))
    assert {"rami-levy", "shufersal", "yochananof", "osher-ad"} <= {s.chain for s in stores}


# ---------- DB + analysis (SQLite always, Postgres if TEST_DATABASE_URL is set) ----------

def _dbs():
    yield "sqlite:///:memory:"
    if os.environ.get("TEST_DATABASE_URL"):
        yield os.environ["TEST_DATABASE_URL"]


@pytest.fixture(params=list(_dbs()))
def db(request):
    d = DB(request.param)
    if d.kind == "postgres":
        for t in ("stores", "products", "current_prices", "price_changes", "promotions", "promo_items",
                  "ingest_runs"):
            d.execute(f"DROP TABLE IF EXISTS {t}")
        d.conn.commit()
    d.init_schema()
    for s in (STORE, OTHER):
        d.execute("INSERT INTO stores (store_key, chain, store_id, name, role) VALUES (?,?,?,?,?)",
                  (s.key, s.chain, s.store_id, s.name, "primary"))
    d.conn.commit()
    yield d
    d.close()


def _load(db, ts="2026-11-11T10:00:00"):
    ingest_prices(db, STORE, list(parse_prices(raw("PriceFull_sample.xml"))), ts)
    ingest_promos(db, STORE, list(parse_promos(raw("PromoFull_sample.xml"))), ts)


def test_ingest_records_changes_only(db):
    s1 = ingest_prices(db, STORE, list(parse_prices(raw("PriceFull_sample.xml"))), "2026-11-10T10:00:00")
    assert s1 == {"rows": 5, "changes": 5, "new": 5}
    s2 = ingest_prices(db, STORE, list(parse_prices(raw("PriceFull_sample.xml"))), "2026-11-11T10:00:00")
    assert s2["changes"] == 0
    items = list(parse_prices(raw("PriceFull_sample.xml")))
    items[0].price = 4.5
    s3 = ingest_prices(db, STORE, items, "2026-11-12T10:00:00")
    assert s3["changes"] == 1
    row = db.query("SELECT price, since, last_seen FROM current_prices WHERE code='7290000066318'")[0]
    assert row == {"price": 4.5, "since": "2026-11-12T10:00:00", "last_seen": "2026-11-12T10:00:00"}
    assert db.query("SELECT COUNT(*) AS n FROM price_changes")[0]["n"] == 6


def test_analyse_verdicts(db):
    _load(db)
    deals = {d.promo_id: d for d in analyse(db, NOW)}
    assert "4" not in deals                      # spend-threshold promo is ignored
    assert deals["1"].promo_unit_price == 3.333 and deals["1"].verdict == "real"
    assert "multi_buy_3" in deals["1"].flags
    assert deals["2"].verdict == "permanent"     # running since 2023
    assert deals["3"].promo_unit_price == 9.6 and deals["3"].verdict == "real"
    assert deals["5"].promo_unit_price == 29.9   # per kg, not 2990


def test_price_raised_before_promo_is_fake(db):
    items = list(parse_prices(raw("PriceFull_sample.xml")))
    items[0].price = 3.5                                           # Bamba was 3.50...
    ingest_prices(db, STORE, items, "2026-10-01T10:00:00")
    _load(db, "2026-10-25T10:00:00")                                # ...raised to 4.00 before the 3-for-10
    deals = {d.promo_id: d for d in analyse(db, NOW)}
    assert "price_raised" in deals["1"].flags
    assert deals["1"].verdict == "fake"


def test_cheaper_elsewhere(db):
    _load(db)
    other = [i for i in parse_prices(raw("PriceFull_sample.xml")) if i.item_code == "7290000066318"]
    other[0].price = 3.2                                            # 3.20 with no promo at the other chain
    ingest_prices(db, OTHER, other, "2026-11-11T10:00:00")
    d = {d.promo_id: d for d in analyse(db, NOW)}["1"]
    assert "cheaper_elsewhere" in d.flags and d.best_other_store == "yo"
    assert d.verdict != "real"


def test_compare(db):
    _load(db)
    res = compare(db, "במבה")
    assert res and res[0]["prices"]["rl"] == {"regular": 4.0, "promo": 3.333}
    assert compare(db, "7290000066318")[0]["code"] == "7290000066318"
