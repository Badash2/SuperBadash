"""Parsing PriceFull / PromoFull / Stores XML files.

All chains use the format set by the Price Transparency regulations, with small
differences: tag case (Item/item), UTF-8 vs UTF-16, ClubID as "0" or as
"0 - כלל הלקוחות", and MinQty/DiscountedPrice at the PromotionItem level (new
format) or at the Promotion level (old format). The parser handles all of them.
Parsing is streaming (iterparse), because some files are tens of MB.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterator

from lxml import etree


def _f(v: str | None) -> float | None:
    if v is None:
        return None
    v = v.strip().replace(",", "")
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _i(v: str | None) -> int | None:
    m = re.match(r"\s*(-?\d+)", v or "")
    return int(m.group(1)) if m else None


def _dt(v: str | None) -> str | None:
    """Normalise to ISO 'YYYY-MM-DDTHH:MM:SS'."""
    if not v or not v.strip():
        return None
    v = v.strip().replace(" ", "T")
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(v, fmt).strftime("%Y-%m-%dT%H:%M:%S")
        except ValueError:
            pass
    return None


def _children(el) -> dict[str, str]:
    """Simple (leaf) children of an element as a {lowercase tag: text} dict."""
    out = {}
    for c in el:
        if isinstance(c.tag, str) and len(c) == 0:
            out[c.tag.lower()] = (c.text or "").strip()
    return out


def _iter(raw: bytes, tag: str):
    """Stream the elements named `tag` (case-insensitive), freeing memory as we go."""
    tag = tag.lower()
    ctx = etree.iterparse(io.BytesIO(raw), events=("end",), recover=True, huge_tree=True)
    for _, el in ctx:
        if isinstance(el.tag, str) and el.tag.lower() == tag:
            yield el
            el.clear()
            while el.getprevious() is not None:
                del el.getparent()[0]


def header(raw: bytes) -> dict[str, str]:
    """ChainID / StoreID / SubChainID from the top of the file."""
    head = raw[:4000].decode("utf-8", "ignore") if raw[:2] not in (b"\xff\xfe", b"\xfe\xff") \
        else raw[:8000].decode("utf-16", "ignore")
    out = {}
    for k in ("ChainID", "SubChainID", "StoreID"):
        m = re.search(rf"<{k}>\s*([^<]*?)\s*</{k}>", head, re.I)
        if m:
            out[k.lower()] = m.group(1)
    return out


GLOBAL_BARCODE = re.compile(r"^\d{8}$|^\d{12,14}$")


def is_global_barcode(code: str, item_type: int | None) -> bool:
    """A manufacturer barcode (EAN/UPC) identifies the same product across chains.
    ItemType=0 marks an internal store code (produce, deli, bakery)."""
    return item_type != 0 and bool(GLOBAL_BARCODE.match(code)) and not code.startswith("0000")


@dataclass
class PriceItem:
    item_code: str
    item_type: int | None
    name: str
    manufacturer: str
    quantity: float | None
    unit: str
    is_weighted: bool
    price: float
    unit_price: float | None
    price_update: str | None


def parse_prices(raw: bytes) -> Iterator[PriceItem]:
    for el in _iter(raw, "Item"):
        d = _children(el)
        code = (d.get("itemcode") or "").strip()
        price = _f(d.get("itemprice"))
        if not code or price is None:
            continue
        yield PriceItem(
            item_code=code,
            item_type=_i(d.get("itemtype")),
            name=d.get("itemname") or d.get("itemnm") or "",
            manufacturer=d.get("manufacturername") or d.get("manufacturename") or "",
            quantity=_f(d.get("quantity")),
            unit=d.get("unitofmeasure") or d.get("unitqty") or "",
            is_weighted=(d.get("bisweighted") or "0").strip() in ("1", "true"),
            price=price,
            unit_price=_f(d.get("unitofmeasureprice")),
            price_update=_dt(d.get("priceupdatetime") or d.get("priceupdatedate")),
        )


@dataclass
class PromoItem:
    item_code: str
    item_type: int | None
    min_qty: float | None
    discounted_price: float | None
    discount_rate: float | None
    reward_type: int | None


@dataclass
class Promotion:
    promo_id: str
    description: str
    start_at: str | None
    end_at: str | None
    club_id: int | None
    is_coupon: bool
    is_gift: bool
    allow_multiple: bool
    min_purchase: float | None
    items: list[PromoItem] = field(default_factory=list)


def parse_promos(raw: bytes) -> Iterator[Promotion]:
    for el in _iter(raw, "Promotion"):
        d = _children(el)
        pid = d.get("promotionid")
        if not pid:
            continue
        start = _dt(d.get("promotionstartdatetime") or
                    " ".join(filter(None, [d.get("promotionstartdate"), d.get("promotionstarthour")])))
        end = _dt(d.get("promotionenddatetime") or
                  " ".join(filter(None, [d.get("promotionenddate"), d.get("promotionendhour")])))
        promo = Promotion(
            promo_id=pid,
            description=d.get("promotiondescription", ""),
            start_at=start,
            end_at=end,
            club_id=_i(d.get("clubid")),
            is_coupon=(d.get("additionaliscoupon") or "0").strip() == "1",
            is_gift=False,
            allow_multiple=(d.get("allowmultiplediscounts") or "0").strip() == "1",
            min_purchase=None,
        )
        # Old format: price/quantity at the promotion level
        top_min, top_price = _f(d.get("minqty")), _f(d.get("discountedprice"))
        top_rate, top_reward = _f(d.get("discountrate")), _i(d.get("rewardtype"))
        for g in el.iter():
            if not isinstance(g.tag, str):
                continue
            t = g.tag.lower()
            if t == "minpurchaseamount" and g.text and g.text.strip():
                promo.min_purchase = _f(g.text)
            if t != "item" and t != "promotionitem":
                continue
            gd = _children(g)
            code = gd.get("itemcode")
            if not code:
                continue
            promo.items.append(PromoItem(
                item_code=code,
                item_type=_i(gd.get("itemtype")),
                min_qty=_f(gd.get("minqty")) if gd.get("minqty") else top_min,
                discounted_price=_f(gd.get("discountedprice")) if gd.get("discountedprice") else top_price,
                discount_rate=_f(gd.get("discountrate")) if gd.get("discountrate") else top_rate,
                reward_type=_i(gd.get("rewardtype")) if gd.get("rewardtype") else top_reward,
            ))
        # "Gift" = every item in the promo goes for 0 (e.g. "buy X, get honey free").
        promo.is_gift = bool(promo.items) and all(i.discounted_price == 0 for i in promo.items)
        yield promo


@dataclass
class StoreInfo:
    store_id: str
    name: str
    address: str
    city: str
    sub_chain: str | None


def parse_stores(raw: bytes) -> Iterator[StoreInfo]:
    for el in _iter(raw, "Store"):
        d = _children(el)
        sid = d.get("storeid")
        if not sid:
            continue
        yield StoreInfo(sid, d.get("storename", ""), d.get("address", ""), d.get("city", ""),
                        d.get("subchainid"))
