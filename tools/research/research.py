#!/usr/bin/env python3
"""The research round: a helper for the scheduled Claude session (or "ask Claude now").

  python3 tools/research/research.py pending [--out DIR] [--limit N]
      Pending requests (research_requests status=pending), grouped by product. For each product it downloads
      to DIR/<code>/: the family's photos (Supabase Storage) and back-of-pack images from Open Food Facts
      (front/ingredients/nutrition + up to 4 raw photos). Writes DIR/manifest.json with what to look at.

  python3 tools/research/research.py save RESULTS.json
      Saves the results: upsert into product_research, and marks the product's requests done/failed with a note.
      Format: [{"code": "...", "status": "done"|"failed", "note": "...", "research": {...product_research fields...}}]

Access: Supabase REST with the secret key. In a Claude cloud session the network proxy injects it
(a network secret on the host hzyqvkqkozabwhhpxngy.supabase.co, header apikey); locally you can set SUPABASE_SECRET_KEY.
SUPABASE_URL can point at a test server (tools/visual-check/mock-supabase.cjs).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

import requests

URL = os.environ.get("SUPABASE_URL", "https://hzyqvkqkozabwhhpxngy.supabase.co").rstrip("/")
OFF = "https://world.openfoodfacts.org/api/v2/product/{code}.json"
OFF_FIELDS = "product_name,image_front_url,image_ingredients_url,image_nutrition_url,images,ingredients_text_he,ingredients_text,nutriments,nova_group"
UA = "superbadash-research/1.0"


def headers() -> dict:
    h = {"User-Agent": UA, "Content-Type": "application/json"}
    key = os.environ.get("SUPABASE_SECRET_KEY")
    if key:  # locally; in the cloud the proxy injects the header
        h["apikey"] = key
    return h


def rest(method: str, path: str, **kw):
    r = requests.request(method, f"{URL}/rest/v1/{path}", headers={**headers(), **kw.pop("headers", {})}, timeout=60, **kw)
    if r.status_code >= 400:
        sys.exit(f"Supabase {method} {path}: {r.status_code} {r.text[:300]}")
    return r.json() if r.text else None


def download(url: str, dest: Path, auth: bool = False) -> bool:
    try:
        r = requests.get(url, headers=headers() if auth else {"User-Agent": UA}, timeout=60)
        if r.status_code == 200 and r.content:
            dest.write_bytes(r.content)
            return True
    except requests.RequestException:
        pass
    return False


def off_images(code: str, folder: Path) -> tuple[list[str], dict]:
    """Back-of-pack images from Open Food Facts: the tagged ones first, then raw photos (often including the back)."""
    try:
        d = requests.get(OFF.format(code=code), params={"fields": OFF_FIELDS}, headers={"User-Agent": UA}, timeout=30).json()
    except (requests.RequestException, ValueError):
        return [], {}
    p = d.get("product") if d.get("status") == 1 else None
    if not p:
        return [], {}
    urls = [p.get(k) for k in ("image_ingredients_url", "image_nutrition_url", "image_front_url") if p.get(k)]
    raw = sorted((k for k in (p.get("images") or {}) if k.isdigit()), key=int, reverse=True)[:4]
    base = f"https://images.openfoodfacts.org/images/products/{'/'.join([code[:3], code[3:6], code[6:9], code[9:]]) if len(code) > 8 else code}"
    urls += [f"{base}/{k}.jpg" for k in raw]
    saved = []
    for i, u in enumerate(dict.fromkeys(urls)):
        dest = folder / f"off_{i}{Path(urllib.parse.urlparse(u).path).suffix or '.jpg'}"
        if download(u, dest):
            saved.append(dest.name)
    known = {
        "off_name": p.get("product_name"),
        "ingredients_text": p.get("ingredients_text_he") or p.get("ingredients_text"),
        "nova": p.get("nova_group"),
        "kcal": (p.get("nutriments") or {}).get("energy-kcal_100g"),
    }
    return saved, known


def cmd_pending(a) -> None:
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    reqs = rest("GET", "research_requests?status=eq.pending&order=requested_at&select=*") or []
    by: dict[str, dict] = {}
    for r in reqs:
        g = by.setdefault(r["code"], {"code": r["code"], "name": r.get("name"), "kinds": [], "notes": [], "request_ids": [], "files": []})
        g["kinds"].append(r["kind"])
        g["request_ids"].append(r["id"])
        if r.get("note"):
            g["notes"].append(r["note"])
    items = list(by.values())[: a.limit]
    for g in items:
        folder = out / g["code"]
        folder.mkdir(exist_ok=True)
        for r in reqs:
            if r["code"] == g["code"] and r.get("photo_path"):
                dest = folder / f"family_{Path(r['photo_path']).name}"
                if download(f"{URL}/storage/v1/object/product-photos/{r['photo_path']}", dest, auth=True):
                    g["files"].append(dest.name)
        if g["code"].isdigit():
            files, known = off_images(g["code"], folder)
            g["files"] += files
            g["off_known"] = known
    (out / "manifest.json").write_text(json.dumps(items, ensure_ascii=False, indent=1))
    print(f"{len(items)} products with pending requests ({len(reqs)} requests). manifest: {out / 'manifest.json'}")
    for g in items:
        print(f"- {g['code']} {g['name'] or ''} | {','.join(g['kinds'])} | {len(g['files'])} images")


RESEARCH_FIELDS = {"ingredients_text", "ingredients_n", "additives", "processing", "nutrition", "reviews_summary",
                   "reviews_score", "reviews_count", "review_sources", "sources"}


def cmd_save(a) -> None:
    results = json.loads(Path(a.file).read_text())
    now = datetime.now(timezone.utc).isoformat()
    for r in results:
        code = r["code"]
        research = {k: v for k, v in (r.get("research") or {}).items() if k in RESEARCH_FIELDS and v is not None}
        if research:
            rest("POST", "product_research?on_conflict=code",
                 headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                 data=json.dumps({"code": code, **research, "updated_at": now}))
        rest("PATCH", f"research_requests?code=eq.{urllib.parse.quote(code)}&status=eq.pending",
             headers={"Prefer": "return=minimal"},
             data=json.dumps({"status": r.get("status", "done"), "result_note": (r.get("note") or "")[:500], "done_at": now}))
        print(f"saved {code}: {r.get('status', 'done')} ({', '.join(research) or 'no data'})")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("pending")
    s.add_argument("--out", default="/tmp/superbadash-research")
    s.add_argument("--limit", type=int, default=25)
    s.set_defaults(fn=cmd_pending)
    s = sub.add_parser("save")
    s.add_argument("file")
    s.set_defaults(fn=cmd_save)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
