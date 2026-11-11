"""Downloading the files that chains publish under the Price Transparency Law.

Two publishing platforms cover all the chains we track:

* Shufersal: its own portal, prices.shufersal.co.il (files sit in Azure Blob).
* Cerberus / publishedprices.co.il: Rami Levy, Yochananof, Osher Ad and many
  others. Login with a public username and an empty password, over HTTPS.
  (The community package il-supermarket-scraper uses FTP for this, which is
  blocked in many networks, so we use the web interface instead.)

File types (`kind`): Stores, PriceFull, Price, PromoFull, Promo.
We use the *Full* files: a complete snapshot, so no deltas are missed.
"""

from __future__ import annotations

import gzip
import html
import logging
import re
import time
import zipfile
import io
from dataclasses import dataclass

import requests

log = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (compatible; superbadash-price-tracker/0.1)"


@dataclass(frozen=True)
class Chain:
    key: str
    name: str
    chain_id: str
    engine: str  # "shufersal" | "publishedprices"
    username: str | None = None


CHAINS: dict[str, Chain] = {
    "shufersal": Chain("shufersal", "שופרסל", "7290027600007", "shufersal"),
    "rami-levy": Chain("rami-levy", "רמי לוי", "7290058140886", "publishedprices", "RamiLevi"),
    "yochananof": Chain("yochananof", "יוחננוף", "7290803800003", "publishedprices", "yohananof"),
    "osher-ad": Chain("osher-ad", "אושר עד", "7290103152017", "publishedprices", "osherad"),
}

_TS_RE = re.compile(r"(\d{8})-?(\d{4,6})")


def file_timestamp(name: str) -> str:
    """Sortable timestamp from a file name, e.g. PriceFull...-20261111-060016.gz."""
    found = _TS_RE.findall(name)
    if not found:
        return ""
    date, tm = found[-1]
    return date + tm.ljust(6, "0")


def decompress(raw: bytes) -> bytes:
    if raw[:2] == b"\x1f\x8b":
        return gzip.decompress(raw)
    if raw[:2] == b"PK":  # a few chains publish zip
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            return z.read(z.namelist()[0])
    return raw


def _get(session: requests.Session, method: str, url: str, **kw) -> requests.Response:
    """HTTP with retries. The portals are slow and sometimes fail transiently."""
    kw.setdefault("timeout", 120)
    last: Exception | None = None
    for attempt in range(4):
        try:
            r = session.request(method, url, **kw)
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            last = e
            wait = 2 ** (attempt + 1)
            log.warning("%s %s failed (%s), retry in %ss", method, url[:80], e, wait)
            time.sleep(wait)
    raise RuntimeError(f"giving up on {url[:120]}: {last}")


class PublishedPrices:
    """Client for url.publishedprices.co.il (Cerberus)."""

    BASE = "https://url.publishedprices.co.il"
    _CSRF = re.compile(r'name="csrftoken"\s+content="([^"]+)"')

    def __init__(self, username: str):
        self.username = username
        self.s = requests.Session()
        self.s.headers["User-Agent"] = USER_AGENT
        self._token: str | None = None
        self._listing: list[str] | None = None

    def _csrf(self, text: str) -> str:
        m = self._CSRF.search(text)
        if not m:
            raise RuntimeError("publishedprices: csrf token not found (login page changed?)")
        return m.group(1)

    def login(self) -> None:
        tok = self._csrf(_get(self.s, "GET", self.BASE + "/login").text)
        r = _get(self.s, "POST", self.BASE + "/login/user", data={
            "username": self.username, "password": "", "csrftoken": tok, "r": "", "Submit": "Sign in",
        })
        if "/login" in r.url and "logout" not in r.text.lower():
            raise RuntimeError(f"publishedprices: login failed for {self.username}")
        self._token = self._csrf(r.text)

    def list_files(self) -> list[str]:
        if self._listing is None:
            if self._token is None:
                self.login()
            r = _get(self.s, "POST", self.BASE + "/file/json/dir", data={
                "sEcho": 1, "iColumns": 5, "iDisplayStart": 0, "iDisplayLength": 100000,
                "cd": "/", "csrftoken": self._token, "sSearch": "",
            })
            self._listing = [f["name"] for f in r.json().get("aaData", []) if f.get("name")]
        return self._listing

    def latest(self, kind: str, store_id: str) -> str | None:
        """Newest file of `kind` for the store. kind: Stores/PriceFull/PromoFull..."""
        if kind == "Stores":
            names = [n for n in self.list_files() if n.startswith("Stores")]
        else:
            tag = f"-{store_id}-"
            names = [n for n in self.list_files() if n.startswith(kind) and tag in n]
            # "Price" must not match "PriceFull"
            names = [n for n in names if n[len(kind)].isdigit()]
        return max(names, key=file_timestamp) if names else None

    def download(self, name: str) -> bytes:
        return decompress(_get(self.s, "GET", f"{self.BASE}/file/d/{name}").content)


class Shufersal:
    """Client for prices.shufersal.co.il."""

    BASE = "https://prices.shufersal.co.il/FileObject/UpdateCategory"
    CATEGORY = {"Price": 1, "PriceFull": 2, "Promo": 3, "PromoFull": 4, "Stores": 5}
    _LINK = re.compile(r'href="(https://pricesprodpublic[^"]+)"')

    def __init__(self):
        self.s = requests.Session()
        self.s.headers["User-Agent"] = USER_AGENT
        self._urls: dict[str, str] = {}

    def latest(self, kind: str, store_id: str) -> str | None:
        cat = self.CATEGORY[kind]
        sid = 0 if kind == "Stores" else int(store_id)
        text = _get(self.s, "GET", f"{self.BASE}?catID={cat}&storeId={sid}").text
        best: tuple[str, str] | None = None
        for url in (html.unescape(u) for u in self._LINK.findall(text)):
            name = url.split("?")[0].rsplit("/", 1)[-1]
            if not name.startswith(kind) or not name[len(kind)].isdigit():
                continue
            if best is None or file_timestamp(name) > file_timestamp(best[0]):
                best = (name, url)
        if best is None:
            return None
        self._urls[best[0]] = best[1]
        return best[0]

    def download(self, name: str) -> bytes:
        return decompress(_get(self.s, "GET", self._urls[name]).content)


def client_for(chain: Chain):
    if chain.engine == "shufersal":
        return Shufersal()
    if chain.engine == "publishedprices":
        return PublishedPrices(chain.username or "")
    raise ValueError(chain.engine)
