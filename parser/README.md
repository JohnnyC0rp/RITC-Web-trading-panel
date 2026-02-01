# RIT Data Scraper

This folder contains a small scraper that captures RIT case + market data to JSONL files for later analysis.

## What it collects
- Case status (`/v1/case`) with tick/period change events
- Securities snapshot + computed price changes (`/v1/securities`)
- Order books (`/v1/securities/book`)
- News (`/v1/news`, incremental)
- Tenders (`/v1/tenders`, incremental)
- Leases (`/v1/leases`, incremental)

## Quick start
```bash
python3 parser/rit_scraper.py --once
```

By default it reads credentials from `creds/rit_rest.json` and writes output under `parser/out/`.

## Useful flags
```bash
# Poll every 0.5s, grab only 5 book levels, cap to 10 tickers
python3 parser/rit_scraper.py --interval 0.5 --book-limit 5 --book-max 10

# Use the client REST API explicitly
python3 parser/rit_scraper.py --mode client

# Pull books only for selected tickers
python3 parser/rit_scraper.py --book-tickers "ABC,RTM,XYZ"
```

## Output files
- `parser/out/snapshots.jsonl` — case + securities snapshot with price deltas
- `parser/out/books.jsonl` — order book per ticker
- `parser/out/news.jsonl` — new news items
- `parser/out/tenders.jsonl` — new/changed tenders
- `parser/out/leases.jsonl` — new/changed leases
- `parser/out/case_events.jsonl` — tick/period/status changes for schedule analysis
- `parser/out/state.json` — last seen IDs/prices for resumable polling

If an endpoint is not supported by a case, the scraper will skip it after a 404.
