#!/usr/bin/env python3
"""Silent DMA REST speed test: prints only final requests/sec."""

from __future__ import annotations

import time
import urllib.parse
import urllib.request

BASE_URL = "http://flserver.rotman.utoronto.ca:10001"
AUTH_HEADER = "Basic WlVBSS0yOm9tZWdh"
TICKER = "CRZY"
REQUESTS = 500
PRINT_EVERY = 25


def make_headers() -> dict:
    return {"Authorization": AUTH_HEADER, "Accept": "application/json"}


def main() -> None:
    params = urllib.parse.urlencode({"ticker": TICKER, "limit": 1})
    url = f"{BASE_URL}/v1/securities/book?{params}"
    headers = make_headers()

    start = time.time()
    for i in range(REQUESTS):
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            _ = resp.read()
        if (i + 1) % PRINT_EVERY == 0:
            elapsed = max(time.time() - start, 0.001)
            rps = (i + 1) / elapsed
            print(f"{i + 1} requests, current speed {rps:.1f} req/s")
    elapsed = max(time.time() - start, 0.001)
    rps = REQUESTS / elapsed
    print(f"{REQUESTS} requests in {elapsed:.3f}s -> {rps:.1f} req/s")


if __name__ == "__main__":
    main()
