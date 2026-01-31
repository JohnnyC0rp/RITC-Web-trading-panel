#!/usr/bin/env python3
"""Simple DMA REST poller: prints best bid/ask once per second."""

from __future__ import annotations

import base64
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

CREDS_PATH = Path(__file__).parent.parent / "creds" / "rit_rest.json"
TICKER = "CRZY"


def load_creds() -> dict:
    if not CREDS_PATH.exists():
        return {}
    return json.loads(CREDS_PATH.read_text(encoding="utf-8"))


def get_auth_header(creds: dict) -> str | None:
    if creds.get("authorization_header"):
        return creds["authorization_header"]
    if creds.get("username") and creds.get("password"):
        token = base64.b64encode(f"{creds['username']}:{creds['password']}".encode()).decode()
        return f"Basic {token}"
    return None


def make_headers(auth_header: str) -> dict:
    return {"Authorization": auth_header, "Accept": "application/json"}


def get_book(base_url: str, auth_header: str) -> dict:
    params = urllib.parse.urlencode({"ticker": TICKER, "limit": 1})
    url = f"{base_url}/v1/securities/book?{params}"
    req = urllib.request.Request(url, headers=make_headers(auth_header))
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.load(resp)


def main() -> None:
    creds = load_creds()
    base_url = creds.get("dma_base_url") or creds.get("base_url")
    if not base_url:
        raise SystemExit("Missing dma_base_url/base_url in creds.")
    auth_header = get_auth_header(creds)
    if not auth_header:
        raise SystemExit("Missing authorization_header or username/password in creds.")
    while True:
        book = get_book(base_url, auth_header)
        bids = book.get("bids") or book.get("bid") or []
        asks = book.get("asks") or book.get("ask") or []
        best_bid = bids[0] if bids else None
        best_ask = asks[0] if asks else None
        ts = time.strftime("%H:%M:%S")
        print(f"{ts} {TICKER} bid={best_bid} ask={best_ask}")
        time.sleep(1)


if __name__ == "__main__":
    main()
