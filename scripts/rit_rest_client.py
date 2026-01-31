#!/usr/bin/env python3
"""Simple RIT REST API client for case status and top-of-book quotes."""

from __future__ import annotations

import argparse
import base64
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CREDS_PATH = Path(__file__).parent.parent / "creds" / "rit_rest.json"

# Non-sensitive defaults (credentials must come from creds/rit_rest.json).
DEFAULTS = {
    "dma_host": "flserver.rotman.utoronto.ca",
    "client_base_url": "http://localhost:9999",
    "default_case": "Volatility Trading Case",
}

CASE_PORTS = {
    "Liquidity Risk Case": {"case_port": 16500, "dma_port": 16510},
    "Volatility Trading Case": {"case_port": 16520, "dma_port": 16530},
    "Merger Arbitrage Case": {"case_port": 16540, "dma_port": 16550},
    "GBE Energy Electricity Trading Case": {"case_port": 16555, "dma_port": None},
    "Algorithmic Market Making Case (server 1)": {"case_port": 16560, "dma_port": 16565},
    "Algorithmic Market Making Case (server 2)": {"case_port": 16570, "dma_port": 16575},
    "Algorithmic Market Making Case (server 3)": {"case_port": 16580, "dma_port": 16585},
}


def load_creds(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Missing creds file: {path}")
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def build_url(base_url: str, path: str, params: dict | None = None) -> str:
    base = base_url.rstrip("/")
    path = path.lstrip("/")
    url = f"{base}/{path}" if path else base
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    return url


def make_headers(creds: dict, use_api_key: bool) -> dict:
    headers = {"Accept": "application/json"}
    username = creds.get("username")
    password = creds.get("password")
    if username and password:
        token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode(
            "ascii"
        )
        headers["Authorization"] = f"Basic {token}"

    if use_api_key and creds.get("api_key"):
        headers["X-API-Key"] = creds["api_key"]

    return headers


def resolve_dma_base_url(creds: dict, case_name: str | None, dma_port: int | None, host: str | None) -> str | None:
    if creds.get("dma_base_url"):
        return creds["dma_base_url"]

    resolved_host = host or creds.get("dma_host") or creds.get("server_host") or DEFAULTS["dma_host"]

    if dma_port is None and creds.get("dma_port"):
        dma_port = creds.get("dma_port")

    if dma_port:
        return f"http://{resolved_host}:{dma_port}"

    selected_case = case_name or creds.get("case_name") or DEFAULTS["default_case"]
    case_info = CASE_PORTS.get(selected_case)
    if case_info and case_info.get("dma_port"):
        return f"http://{resolved_host}:{case_info['dma_port']}"

    return None


def request_json(url: str, headers: dict) -> dict:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=10) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"raw": raw}


def get_case(base_url: str, headers: dict) -> dict:
    url = build_url(base_url, "/v1/case")
    return request_json(url, headers)


def get_book(base_url: str, headers: dict, ticker: str) -> dict:
    url = build_url(base_url, "/v1/securities/book", {"ticker": ticker})
    return request_json(url, headers)


def summarize_book(book: dict) -> str:
    bids = book.get("bids") or book.get("bid") or []
    asks = book.get("asks") or book.get("ask") or []
    best_bid = bids[0] if bids else None
    best_ask = asks[0] if asks else None
    return f"best_bid={best_bid}, best_ask={best_ask}"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fetch RIT case status and top-of-book quotes."
    )
    parser.add_argument(
        "--ticker", default="ABC", help="Security ticker (default: ABC)"
    )
    parser.add_argument(
        "--client",
        action="store_true",
        help="Use client_base_url (localhost:9999) instead of DMA base_url",
    )
    parser.add_argument(
        "--use-api-key",
        action="store_true",
        help="Send X-API-Key header if present in creds",
    )
    parser.add_argument("--dma-base-url", help="Override DMA base URL (e.g., http://flserver:16530)")
    parser.add_argument("--dma-port", type=int, help="Override DMA port (uses dma_host)")
    parser.add_argument("--dma-host", help="Override DMA host (default: flserver.rotman.utoronto.ca)")
    parser.add_argument("--case", help="Case name for DMA port selection (see CASE_PORTS)")
    parser.add_argument("--list-cases", action="store_true", help="List known cases and exit")
    args = parser.parse_args()

    try:
        creds = load_creds(CREDS_PATH)
    except Exception as exc:
        print(f"Failed to load creds: {exc}", file=sys.stderr)
        return 1

    if args.list_cases:
        for name, ports in CASE_PORTS.items():
            print(f"{name}: case_port={ports['case_port']}, dma_port={ports['dma_port']}")
        return 0

    base_url = None
    if args.client:
        base_url = creds.get("client_base_url") or DEFAULTS["client_base_url"]
    else:
        if args.dma_base_url:
            base_url = args.dma_base_url
        else:
            base_url = resolve_dma_base_url(creds, args.case, args.dma_port, args.dma_host)
        if not base_url and creds.get("base_url"):
            base_url = creds["base_url"]
    if not base_url:
        print("Missing base_url in creds.", file=sys.stderr)
        return 1

    merged_creds = {**DEFAULTS, **creds}
    headers = make_headers(merged_creds, args.use_api_key)

    try:
        case = get_case(base_url, headers)
        book = get_book(base_url, headers, args.ticker)
    except urllib.error.HTTPError as exc:
        print(f"HTTP error: {exc.code} {exc.reason}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"Connection error: {exc.reason}", file=sys.stderr)
        if not args.client:
            print("Hint: ensure the DMA host resolves (flserver.rotman.utoronto.ca) and you are on the RIT network/VPN.", file=sys.stderr)
        else:
            print("Hint: ensure the RIT User App REST API is running locally and port 9999 is free.", file=sys.stderr)
        return 1

    print(f"Base URL: {base_url}")
    print(f"Case: {case}")
    print(f"Book ({args.ticker}): {summarize_book(book)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
