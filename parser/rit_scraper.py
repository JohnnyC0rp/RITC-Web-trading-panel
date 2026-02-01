#!/usr/bin/env python3
"""Scrape RIT case/market data and store JSONL for analysis."""

from __future__ import annotations

import argparse
import base64
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

DEFAULT_CREDS_PATH = Path(__file__).resolve().parents[1] / "creds" / "rit_rest.json"
DEFAULT_OUT_DIR = Path(__file__).resolve().parent / "out"

MODE_CLIENT = "client"
MODE_DMA = "dma"


@dataclass
class OutputPaths:
    out_dir: Path
    snapshots: Path = field(init=False)
    books: Path = field(init=False)
    news: Path = field(init=False)
    tenders: Path = field(init=False)
    leases: Path = field(init=False)
    case_events: Path = field(init=False)
    state: Path = field(init=False)

    def __post_init__(self) -> None:
        self.snapshots = self.out_dir / "snapshots.jsonl"
        self.books = self.out_dir / "books.jsonl"
        self.news = self.out_dir / "news.jsonl"
        self.tenders = self.out_dir / "tenders.jsonl"
        self.leases = self.out_dir / "leases.jsonl"
        self.case_events = self.out_dir / "case_events.jsonl"
        self.state = self.out_dir / "state.json"


@dataclass
class ScrapeState:
    last_news_id: int | None = None
    last_prices: dict[str, dict[str, float | None]] = field(default_factory=dict)
    first_prices: dict[str, float | None] = field(default_factory=dict)
    last_case: dict[str, Any] | None = None
    last_tick_ts: float | None = None
    last_period_ts: float | None = None
    last_tenders: dict[str, str] = field(default_factory=dict)
    last_leases: dict[str, str] = field(default_factory=dict)
    disabled_endpoints: set[str] = field(default_factory=set)

    @classmethod
    def load(cls, path: Path) -> "ScrapeState":
        if not path.exists():
            return cls()
        raw = json.loads(path.read_text(encoding="utf-8"))
        state = cls()
        state.last_news_id = raw.get("last_news_id")
        state.last_prices = raw.get("last_prices") or {}
        state.first_prices = raw.get("first_prices") or {}
        state.last_case = raw.get("last_case")
        state.last_tick_ts = raw.get("last_tick_ts")
        state.last_period_ts = raw.get("last_period_ts")
        state.last_tenders = raw.get("last_tenders") or {}
        state.last_leases = raw.get("last_leases") or {}
        state.disabled_endpoints = set(raw.get("disabled_endpoints") or [])
        return state

    def save(self, path: Path) -> None:
        data = {
            "last_news_id": self.last_news_id,
            "last_prices": self.last_prices,
            "first_prices": self.first_prices,
            "last_case": self.last_case,
            "last_tick_ts": self.last_tick_ts,
            "last_period_ts": self.last_period_ts,
            "last_tenders": self.last_tenders,
            "last_leases": self.last_leases,
            "disabled_endpoints": sorted(self.disabled_endpoints),
        }
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=True, indent=2), encoding="utf-8")


@dataclass
class ClientConfig:
    base_url: str
    headers: dict[str, str]
    mode: str


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_url(base_url: str, path: str, params: dict[str, Any] | None = None) -> str:
    base = base_url.rstrip("/")
    path = path.lstrip("/")
    url = f"{base}/{path}" if path else base
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    return url


def normalize_base_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    return base


def fingerprint(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def write_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=True) + "\n")


def load_creds(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Missing creds file: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_base_url(creds: dict[str, Any], mode: str, override: str | None) -> str:
    if override:
        return normalize_base_url(override)
    if mode == MODE_CLIENT:
        return normalize_base_url(creds.get("client_base_url") or "http://localhost:9999")
    base_url = creds.get("dma_base_url") or creds.get("base_url")
    if base_url:
        return normalize_base_url(base_url)
    host = creds.get("dma_host") or creds.get("server_host")
    port = creds.get("dma_port")
    if host and port:
        return normalize_base_url(f"http://{host}:{port}")
    raise ValueError("Missing base URL configuration in creds.")


def make_headers(creds: dict[str, Any], mode: str) -> dict[str, str]:
    headers = {"Accept": "application/json"}
    if mode == MODE_CLIENT:
        api_key = creds.get("api_key")
        if not api_key:
            raise ValueError("Missing api_key for client REST API.")
        headers["X-API-Key"] = api_key
        return headers

    auth_header = creds.get("authorization_header")
    if auth_header:
        headers["Authorization"] = auth_header
        return headers

    username = creds.get("username")
    password = creds.get("password")
    if not username or not password:
        raise ValueError("Missing username/password for DMA REST API.")
    token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    headers["Authorization"] = f"Basic {token}"
    return headers


def request_json(url: str, headers: dict[str, str]) -> tuple[int, Any, dict[str, Any]]:
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = {"raw": raw}
            return resp.status, payload, dict(resp.headers)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw}
        return exc.code, payload, dict(exc.headers)
    except urllib.error.URLError as exc:
        return 0, {"error": str(exc.reason)}, {}


def extract_retry_after(payload: Any, headers: dict[str, Any]) -> float:
    wait = None
    if isinstance(payload, dict):
        wait = payload.get("wait")
    if wait is None:
        wait = headers.get("Retry-After")
    try:
        return max(float(wait), 0.0)
    except (TypeError, ValueError):
        return 0.5


def request_json_with_retry(url: str, headers: dict[str, str], retries: int = 2) -> tuple[int, Any, dict[str, Any]]:
    for attempt in range(retries + 1):
        status, payload, resp_headers = request_json(url, headers)
        if status != 429:
            return status, payload, resp_headers
        wait = extract_retry_after(payload, resp_headers)
        # Gentle backoff: the server needs a sip of coffee.
        time.sleep(wait)
    return status, payload, resp_headers


def ensure_ok(status: int, payload: Any, label: str) -> None:
    if status == 401:
        raise RuntimeError(f"Unauthorized for {label}. Check credentials.")
    if status == 0:
        raise RuntimeError(f"Connection error while fetching {label}.")


def diff(current: float | None, prev: float | None) -> float | None:
    if current is None or prev is None:
        return None
    return current - prev


def pct_change(current: float | None, prev: float | None) -> float | None:
    if current is None or prev in (None, 0):
        return None
    return (current - prev) / prev * 100


def enrich_securities(securities: Iterable[dict[str, Any]], state: ScrapeState) -> list[dict[str, Any]]:
    enriched = []
    for sec in securities:
        ticker = sec.get("ticker")
        last = sec.get("last")
        bid = sec.get("bid")
        ask = sec.get("ask")
        mid = None
        if bid is not None and ask is not None:
            mid = (bid + ask) / 2

        prev = state.last_prices.get(ticker, {}) if ticker else {}
        prev_last = prev.get("last")
        prev_mid = prev.get("mid")

        if ticker and ticker not in state.first_prices and last is not None:
            state.first_prices[ticker] = last
        first = state.first_prices.get(ticker) if ticker else None

        if ticker:
            state.last_prices[ticker] = {"last": last, "mid": mid}

        enriched.append(
            {
                **sec,
                "mid": mid,
                "delta_last": diff(last, prev_last),
                "pct_last": pct_change(last, prev_last),
                "delta_mid": diff(mid, prev_mid),
                "pct_mid": pct_change(mid, prev_mid),
                "delta_from_start": diff(last, first),
                "pct_from_start": pct_change(last, first),
            }
        )
    return enriched


def detect_case_events(state: ScrapeState, case: dict[str, Any], now_ts: float, now_str: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    if state.last_case is None:
        events.append({"ts": now_str, "event": "case_start", "case": case})
        state.last_tick_ts = now_ts
        state.last_period_ts = now_ts
        state.last_case = case
        return events

    prev = state.last_case
    if case.get("name") != prev.get("name"):
        events.append(
            {
                "ts": now_str,
                "event": "case_change",
                "prev": prev.get("name"),
                "current": case.get("name"),
            }
        )

    if case.get("status") != prev.get("status"):
        events.append(
            {
                "ts": now_str,
                "event": "status_change",
                "prev": prev.get("status"),
                "current": case.get("status"),
            }
        )

    if case.get("period") != prev.get("period"):
        delta = None
        if state.last_period_ts is not None:
            delta = now_ts - state.last_period_ts
        state.last_period_ts = now_ts
        events.append(
            {
                "ts": now_str,
                "event": "period_change",
                "prev": prev.get("period"),
                "current": case.get("period"),
                "seconds_since_last_period": delta,
            }
        )

    if case.get("tick") != prev.get("tick"):
        delta = None
        if state.last_tick_ts is not None:
            delta = now_ts - state.last_tick_ts
        state.last_tick_ts = now_ts
        events.append(
            {
                "ts": now_str,
                "event": "tick_change",
                "prev": prev.get("tick"),
                "current": case.get("tick"),
                "seconds_since_last_tick": delta,
            }
        )

    state.last_case = case
    return events


def record_items(
    items: list[dict[str, Any]],
    state_map: dict[str, str],
    output_path: Path,
    now_str: str,
    id_key: str,
    label: str,
) -> int:
    count = 0
    for item in items:
        raw_id = item.get(id_key)
        if raw_id is None:
            continue
        key = str(raw_id)
        fp = fingerprint(item)
        if state_map.get(key) == fp:
            continue
        state_map[key] = fp
        write_jsonl(output_path, {"ts": now_str, label: item})
        count += 1
    return count


def select_book_tickers(all_tickers: list[str], args: argparse.Namespace) -> list[str]:
    if args.book_tickers:
        tickers = [t.strip() for t in args.book_tickers.split(",") if t.strip()]
    else:
        tickers = list(all_tickers)
    if args.book_max is not None and len(tickers) > args.book_max:
        tickers = tickers[: args.book_max]
    return tickers


def poll_once(config: ClientConfig, paths: OutputPaths, state: ScrapeState, args: argparse.Namespace) -> None:
    now_ts = time.time()
    now_str = now_iso()

    case_url = build_url(config.base_url, "/v1/case")
    status, case_payload, _ = request_json_with_retry(case_url, config.headers)
    ensure_ok(status, case_payload, "case")
    if status != 200:
        print(f"Case fetch failed (status {status}).")
        return

    case_events = detect_case_events(state, case_payload, now_ts, now_str)
    for event in case_events:
        write_jsonl(paths.case_events, event)

    sec_url = build_url(config.base_url, "/v1/securities")
    status, securities_payload, _ = request_json_with_retry(sec_url, config.headers)
    ensure_ok(status, securities_payload, "securities")
    if status != 200 or not isinstance(securities_payload, list):
        print(f"Securities fetch failed (status {status}).")
        return

    enriched = enrich_securities(securities_payload, state)
    tickers = [sec.get("ticker") for sec in securities_payload if sec.get("ticker")]

    snapshot = {
        "ts": now_str,
        "case": case_payload,
        "tickers": tickers,
        "securities": enriched,
    }
    write_jsonl(paths.snapshots, snapshot)

    if not args.skip_books:
        book_tickers = select_book_tickers(tickers, args)
        for ticker in book_tickers:
            book_url = build_url(
                config.base_url, "/v1/securities/book", {"ticker": ticker, "limit": args.book_limit}
            )
            status, book_payload, _ = request_json_with_retry(book_url, config.headers)
            if status == 429:
                print(f"Rate-limited on book for {ticker}.")
                continue
            ensure_ok(status, book_payload, f"book:{ticker}")
            if status == 200:
                write_jsonl(paths.books, {"ts": now_str, "ticker": ticker, "book": book_payload})
            if args.book_delay > 0:
                time.sleep(args.book_delay)

    if not args.skip_news:
        news_params = {"limit": args.news_limit}
        if state.last_news_id is not None:
            key = "after" if config.mode == MODE_DMA else "since"
            news_params[key] = state.last_news_id
        news_url = build_url(config.base_url, "/v1/news", news_params)
        status, news_payload, _ = request_json_with_retry(news_url, config.headers)
        ensure_ok(status, news_payload, "news")
        if status == 200 and isinstance(news_payload, list):
            for item in sorted(news_payload, key=lambda x: x.get("news_id", 0)):
                news_id = item.get("news_id")
                if news_id is not None:
                    state.last_news_id = max(state.last_news_id or 0, int(news_id))
                write_jsonl(paths.news, {"ts": now_str, "news": item})

    if not args.skip_tenders and "tenders" not in state.disabled_endpoints:
        tender_url = build_url(config.base_url, "/v1/tenders")
        status, tender_payload, _ = request_json_with_retry(tender_url, config.headers)
        if status == 404:
            state.disabled_endpoints.add("tenders")
        else:
            ensure_ok(status, tender_payload, "tenders")
            if status == 200 and isinstance(tender_payload, list):
                record_items(tender_payload, state.last_tenders, paths.tenders, now_str, "tender_id", "tender")

    if not args.skip_leases and "leases" not in state.disabled_endpoints:
        leases_url = build_url(config.base_url, "/v1/leases")
        status, leases_payload, _ = request_json_with_retry(leases_url, config.headers)
        if status == 404:
            state.disabled_endpoints.add("leases")
        else:
            ensure_ok(status, leases_payload, "leases")
            if status == 200 and isinstance(leases_payload, list):
                record_items(leases_payload, state.last_leases, paths.leases, now_str, "id", "lease")

    state.save(paths.state)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape RIT data to JSONL files.")
    parser.add_argument("--creds", default=str(DEFAULT_CREDS_PATH), help="Path to creds JSON")
    parser.add_argument(
        "--mode",
        choices=[MODE_DMA, MODE_CLIENT],
        help="Connection mode. Defaults to dma if creds include username/password.",
    )
    parser.add_argument("--base-url", help="Override base URL for REST API")
    parser.add_argument("--interval", type=float, default=1.0, help="Polling interval in seconds")
    parser.add_argument("--once", action="store_true", help="Run a single poll and exit")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR), help="Directory to store output JSONL")

    parser.add_argument("--book-limit", type=int, default=10, help="Order book depth per side")
    parser.add_argument("--book-tickers", help="Comma-separated tickers to pull books for")
    parser.add_argument("--book-max", type=int, help="Max number of tickers to pull books for")
    parser.add_argument("--book-delay", type=float, default=0.0, help="Delay between book requests (seconds)")
    parser.add_argument("--skip-books", action="store_true", help="Skip order book polling")

    parser.add_argument("--news-limit", type=int, default=20, help="News items per poll")
    parser.add_argument("--skip-news", action="store_true", help="Skip news polling")

    parser.add_argument("--skip-tenders", action="store_true", help="Skip tenders polling")
    parser.add_argument("--skip-leases", action="store_true", help="Skip leases polling")

    return parser.parse_args()


def resolve_mode(creds: dict[str, Any], mode_override: str | None) -> str:
    if mode_override:
        return mode_override
    if creds.get("api_key") and not (creds.get("username") or creds.get("authorization_header")):
        return MODE_CLIENT
    return MODE_DMA


def main() -> int:
    args = parse_args()
    creds = load_creds(Path(args.creds))
    mode = resolve_mode(creds, args.mode)
    base_url = resolve_base_url(creds, mode, args.base_url)
    headers = make_headers(creds, mode)

    config = ClientConfig(base_url=base_url, headers=headers, mode=mode)
    paths = OutputPaths(out_dir=Path(args.out_dir))
    state = ScrapeState.load(paths.state)

    print(f"Scraping via {mode} at {base_url}")
    while True:
        poll_once(config, paths, state, args)
        if args.once:
            break
        time.sleep(args.interval)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
