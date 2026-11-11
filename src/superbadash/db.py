"""Data layer. Works with SQLite (local) and with Postgres (production: Supabase/Neon).

The SQL is written with `?` placeholders and plain types, and is translated to
`%s` for Postgres. Both support INSERT ... ON CONFLICT DO UPDATE.

Model:
  stores           the branches we track
  products         product catalogue. code = barcode (shared by all chains) or
                   "<chain>:<internal code>" for produce, deli and other unbarcoded items
  current_prices   current shelf price per store and product (last_seen = still on sale)
  price_changes    history: a row only when a price changes. The base for spotting
                   "fake promotions" (price raised just before a promo)
  promotions       promotions (header), first_seen/last_seen tracked over time
  promo_items      products in each promotion with promo price / min. quantity
  ingest_runs      run log, so the same file isn't processed twice
  deals            deal-engine output (the site reads it)
"""

from __future__ import annotations

import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS stores (
    store_key   TEXT PRIMARY KEY,
    chain       TEXT NOT NULL,
    store_id    TEXT NOT NULL,
    name        TEXT NOT NULL,
    role        TEXT
);

CREATE TABLE IF NOT EXISTS products (
    code         TEXT PRIMARY KEY,
    barcode      TEXT,
    name         TEXT NOT NULL,
    manufacturer TEXT,
    quantity     REAL,
    unit         TEXT,
    is_weighted  INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS current_prices (
    store_key   TEXT NOT NULL,
    code        TEXT NOT NULL,
    price       REAL NOT NULL,
    unit_price  REAL,
    since       TEXT NOT NULL,
    last_seen   TEXT NOT NULL,
    PRIMARY KEY (store_key, code)
);

CREATE TABLE IF NOT EXISTS price_changes (
    store_key   TEXT NOT NULL,
    code        TEXT NOT NULL,
    changed_at  TEXT NOT NULL,
    old_price   REAL,
    new_price   REAL NOT NULL,
    PRIMARY KEY (store_key, code, changed_at)
);

CREATE TABLE IF NOT EXISTS promotions (
    store_key      TEXT NOT NULL,
    promo_id       TEXT NOT NULL,
    description    TEXT,
    start_at       TEXT,
    end_at         TEXT,
    club_id        INTEGER,
    is_coupon      INTEGER NOT NULL DEFAULT 0,
    is_gift        INTEGER NOT NULL DEFAULT 0,
    allow_multiple INTEGER NOT NULL DEFAULT 0,
    min_purchase   REAL,
    item_count     INTEGER NOT NULL DEFAULT 0,
    first_seen     TEXT NOT NULL,
    last_seen      TEXT NOT NULL,
    PRIMARY KEY (store_key, promo_id)
);

CREATE TABLE IF NOT EXISTS promo_items (
    store_key        TEXT NOT NULL,
    promo_id         TEXT NOT NULL,
    code             TEXT NOT NULL,
    min_qty          REAL,
    discounted_price REAL,
    discount_rate    REAL,
    reward_type      INTEGER,
    PRIMARY KEY (store_key, promo_id, code)
);

CREATE TABLE IF NOT EXISTS ingest_runs (
    store_key   TEXT NOT NULL,
    kind        TEXT NOT NULL,
    file_name   TEXT NOT NULL,
    ingested_at TEXT NOT NULL,
    rows        INTEGER NOT NULL,
    changes     INTEGER NOT NULL,
    PRIMARY KEY (store_key, kind, file_name)
);

CREATE TABLE IF NOT EXISTS deals (
    store_key         TEXT NOT NULL,
    code              TEXT NOT NULL,
    promo_id          TEXT,
    description       TEXT,
    regular_price     REAL,
    promo_unit_price  REAL,
    min_qty           REAL,
    discount_pct      REAL,
    market_saving_pct REAL,
    verdict           TEXT NOT NULL,
    flags             TEXT,
    end_at            TEXT,
    computed_at       TEXT NOT NULL,
    PRIMARY KEY (store_key, code)
);

CREATE INDEX IF NOT EXISTS ix_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS ix_promo_items_code ON promo_items(code);
CREATE INDEX IF NOT EXISTS ix_price_changes_code ON price_changes(code, changed_at);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%S")


class DB:
    """Thin wrapper: SQLite or Postgres, chosen by URL."""

    def __init__(self, url: str | None = None):
        url = url or os.environ.get("DATABASE_URL") or "sqlite:///data/superbadash.sqlite"
        self.url = url
        if url.startswith(("postgres://", "postgresql://")):
            import psycopg  # optional dependency: pip install .[postgres]
            self.kind = "postgres"
            self.conn = psycopg.connect(url, autocommit=False)
        else:
            self.kind = "sqlite"
            path = re.sub(r"^sqlite:///", "", url)
            if path != ":memory:":
                os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
            self.conn = sqlite3.connect(path)
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.execute("PRAGMA synchronous=NORMAL")

    def _sql(self, sql: str) -> str:
        return sql.replace("?", "%s") if self.kind == "postgres" else sql

    def execute(self, sql: str, params: tuple | list = ()):
        cur = self.conn.cursor()
        cur.execute(self._sql(sql), params)
        return cur

    def executemany(self, sql: str, rows: list) -> None:
        if rows:
            self.conn.cursor().executemany(self._sql(sql), rows)

    def query(self, sql: str, params: tuple | list = ()) -> list[dict]:
        cur = self.execute(sql, params)
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    def init_schema(self) -> None:
        for stmt in SCHEMA.split(";"):
            if stmt.strip():
                self.execute(stmt)
        self.conn.commit()

    @contextmanager
    def transaction(self):
        try:
            yield self
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    def migrate(self, directory: str) -> list[str]:
        """Apply SQL migrations (Postgres/Supabase only) in file-name order, each exactly once."""
        if self.kind != "postgres":
            return []
        import glob
        self.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
        self.execute("ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY")
        self.conn.commit()
        done = {r["version"] for r in self.query("SELECT version FROM schema_migrations")}
        applied = []
        for path in sorted(glob.glob(os.path.join(directory, "*.sql"))):
            version = os.path.basename(path)
            if version in done:
                continue
            with open(path, encoding="utf-8") as f:
                sql = f.read()
            with self.transaction():
                self.conn.cursor().execute(sql)  # the whole file in one transaction
                self.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", (version, now_iso()))
            applied.append(version)
        return applied

    def close(self) -> None:
        self.conn.close()
