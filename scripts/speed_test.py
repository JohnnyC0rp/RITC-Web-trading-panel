#!/usr/bin/env python3
"""Silent DMA REST speed test: prints only final requests/sec."""

from __future__ import annotations

import base64
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

CREDS_PATH = Path(__file__).parent.parent / "creds" / "rit_rest.json"
TICKER = "CRZY"
REQUESTS = 500
PRINT_EVERY = 25


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


def main() -> None:
    creds = load_creds()
    base_url = creds.get("dma_base_url") or creds.get("base_url")
    if not base_url:
        raise SystemExit("Missing dma_base_url/base_url in creds.")
    auth_header = get_auth_header(creds)
    if not auth_header:
        raise SystemExit("Missing authorization_header or username/password in creds.")
    params = urllib.parse.urlencode({"ticker": TICKER, "limit": 1})
    url = f"{base_url}/v1/securities/book?{params}"
    headers = make_headers(auth_header)

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
