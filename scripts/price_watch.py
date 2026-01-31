#!/usr/bin/env python3
"""Polls RIT prices/order book and prints updates in-place."""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CREDS_PATH = Path(__file__).parent / "creds" / "rit_rest.json"


def load_creds(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def clear_screen(enabled: bool) -> None:
    if not enabled:
        return
    # ANSI clear + cursor home (works in modern Windows terminals too).
    print("\x1b[2J\x1b[H", end="")


def build_url(base_url: str, path: str, params: dict | None = None) -> str:
    base = base_url.rstrip("/")
    path = path.lstrip("/")
    url = f"{base}/{path}" if path else base
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    return url


def make_headers_client(api_key: str) -> dict:
    return {"Accept": "application/json", "X-API-Key": api_key}


def make_headers_dma(username: str, password: str) -> dict:
    token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    return {"Accept": "application/json", "Authorization": f"Basic {token}"}


def request_json(url: str, headers: dict) -> tuple[int, dict, dict]:
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(raw), dict(resp.headers)
            except json.JSONDecodeError:
                return resp.status, {"raw": raw}, dict(resp.headers)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        payload = {}
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw}
        return exc.code, payload, dict(exc.headers)


def summarize_book(book: dict) -> tuple[dict | None, dict | None]:
    bids = book.get("bids") or book.get("bid") or []
    asks = book.get("asks") or book.get("ask") or []
    best_bid = bids[0] if bids else None
    best_ask = asks[0] if asks else None
    return best_bid, best_ask


def _get_level_qty(level: dict) -> int | float | None:
    for key in ("quantity", "qty", "size", "volume"):
        if key in level:
            return level[key]
    return None


def _format_num(value: int | float | None, width: int = 10) -> str:
    if value is None:
        return " " * width
    try:
        if isinstance(value, float):
            return f"{value:>{width}.4f}"
        return f"{value:>{width}d}"
    except Exception:
        return f"{str(value):>{width}}"


def format_book_pretty(book: dict, depth: int) -> str:
    lines = []
    meta = {k: v for k, v in book.items() if k not in ("bids", "asks", "bid", "ask")}
    if meta:
        for key in sorted(meta.keys()):
            lines.append(f"{key}: {meta[key]}")
        lines.append("")

    bids = book.get("bids") or book.get("bid") or []
    asks = book.get("asks") or book.get("ask") or []

    lines.append("Order Book (top levels)")
    lines.append("Side |    Price |       Qty | Extra")
    lines.append("-----+----------+-----------+------------------------------")

    max_depth = max(len(bids), len(asks), depth)
    max_depth = min(max_depth, max(depth, len(bids), len(asks)))
    max_depth = max_depth if max_depth > 0 else depth
    max_depth = min(max_depth, 50)

    for i in range(max_depth):
        bid = bids[i] if i < len(bids) else None
        ask = asks[i] if i < len(asks) else None

        if bid is not None:
            bid_price = bid.get("price")
            bid_qty = _get_level_qty(bid)
            extra = {k: v for k, v in bid.items() if k not in ("price", "quantity", "qty", "size", "volume")}
            lines.append(
                f"BID  |{_format_num(bid_price)}|{_format_num(bid_qty, 11)}| {extra}"
            )

        if ask is not None:
            ask_price = ask.get("price")
            ask_qty = _get_level_qty(ask)
            extra = {k: v for k, v in ask.items() if k not in ("price", "quantity", "qty", "size", "volume")}
            lines.append(
                f"ASK  |{_format_num(ask_price)}|{_format_num(ask_qty, 11)}| {extra}"
            )

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Poll RIT order book and print updates.")
    parser.add_argument("--ticker", default="ABC", help="Ticker (default: ABC)")
    parser.add_argument("--interval", type=float, default=0.5, help="Poll interval in seconds")
    parser.add_argument("--depth", type=int, default=5, help="Order book depth to request/display")
    parser.add_argument("--no-clear", action="store_true", help="Do not clear screen between updates")
    parser.add_argument("--client", action="store_true", help="Use Client REST API (localhost) instead of DMA")
    parser.add_argument("--base-url", help="Override base URL directly")
    parser.add_argument(
        "--test-rate",
        action="store_true",
        help="Stress-test update speed until rate-limited (HTTP 429).",
    )
    parser.add_argument(
        "--max-requests",
        type=int,
        default=5000,
        help="Max requests during rate test (default: 5000).",
    )
    args = parser.parse_args()

    creds = load_creds(CREDS_PATH)

    if args.base_url:
        base_url = args.base_url
        use_client = args.client
    else:
        use_client = args.client
        if use_client:
            base_url = creds.get("client_base_url", "http://localhost:9999")
        else:
            base_url = creds.get("dma_base_url") or creds.get("base_url")
            if not base_url:
                print("Missing dma_base_url/base_url in creds. Use --base-url.", file=sys.stderr)
                return 1

    if use_client:
        api_key = creds.get("api_key")
        if not api_key:
            print("Missing api_key in creds for Client REST API.", file=sys.stderr)
            return 1
        headers = make_headers_client(api_key)
    else:
        username = creds.get("username")
        password = creds.get("password")
        if not username or not password:
            print("Missing username/password in creds for DMA API.", file=sys.stderr)
            return 1
        headers = make_headers_dma(username, password)

    if args.test_rate:
        start = time.time()
        count = 0
        while count < args.max_requests:
            book_url = build_url(base_url, "/v1/securities/book", {"ticker": args.ticker, "limit": 1})
            status, book, hdrs = request_json(book_url, headers)
            count += 1

            if status == 429:
                elapsed = max(time.time() - start, 0.001)
                rps = count / elapsed
                wait = float(book.get("wait") or hdrs.get("Retry-After") or 1)
                print(f"Rate limited after {count} requests in {elapsed:.3f}s (~{rps:.1f} req/s).")
                print(f"Retry-After / wait: {wait}s")
                return 0

            if status != 200:
                print(f"HTTP {status}: {book}")
                return 1

        elapsed = max(time.time() - start, 0.001)
        rps = count / elapsed
        print(f"No 429 within {count} requests in {elapsed:.3f}s (~{rps:.1f} req/s).")
        return 0

    while True:
        book_url = build_url(base_url, "/v1/securities/book", {"ticker": args.ticker, "limit": args.depth})
        status, book, hdrs = request_json(book_url, headers)

        if status == 429:
            wait = float(book.get("wait") or hdrs.get("Retry-After") or 1)
            clear_screen(not args.no_clear)
            print(f"Rate limited (429). Waiting {wait:.2f}s...")
            time.sleep(wait)
            continue

        clear_screen(not args.no_clear)
        if status != 200:
            print(f"HTTP {status}: {book}")
            time.sleep(max(args.interval, 0.2))
            continue

        print(f"Base: {base_url}")
        print(f"Ticker: {args.ticker}")
        print(f"Updated: {time.strftime('%H:%M:%S')}")
        print("")
        print(format_book_pretty(book, args.depth))

        time.sleep(max(args.interval, 0.05))


if __name__ == "__main__":
    raise SystemExit(main())
