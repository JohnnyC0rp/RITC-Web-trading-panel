#!/usr/bin/env python3
"""Simple DMA REST poller: prints best bid/ask once per second."""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request

BASE_URL = "http://flserver.rotman.utoronto.ca:10001"
AUTH_HEADER = "Basic WlVBSS0yOm9tZWdh"
TICKER = "CRZY"


def make_headers() -> dict:
    return {"Authorization": AUTH_HEADER, "Accept": "application/json"}


def get_book() -> dict:
    params = urllib.parse.urlencode({"ticker": TICKER, "limit": 1})
    url = f"{BASE_URL}/v1/securities/book?{params}"
    req = urllib.request.Request(url, headers=make_headers())
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.load(resp)


def main() -> None:
    while True:
        book = get_book()
        bids = book.get("bids") or book.get("bid") or []
        asks = book.get("asks") or book.get("ask") or []
        best_bid = bids[0] if bids else None
        best_ask = asks[0] if asks else None
        ts = time.strftime("%H:%M:%S")
        print(f"{ts} {TICKER} bid={best_bid} ask={best_ask}")
        time.sleep(1)


if __name__ == "__main__":
    main()
