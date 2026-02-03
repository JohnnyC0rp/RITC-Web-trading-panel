<p align="center">
  <img src="./public/logo-transparent.png" alt="Privod Johnny logo" width="72" height="72" />
</p>

<img width="1764" height="890" alt="Untitled" src="https://github.com/user-attachments/assets/05bd7bf3-ac50-4805-9576-8f66ab41ce7b" />



# Privod Johnny — RITC Web Trading Panel

A modern web interface that replaces the Excel / native Windows RIT client for connecting to RITC practice and live servers. It supports **Local (Client REST API)** and **Remote (DMA REST API)** flows, includes a live order book, candles (Plotly), and full API tooling.

## Why this exists
- The official UI is heavy and Windows-only.
- We want a **fast, modern, cross‑platform** client that works on macOS + Windows.
- The app provides the same API access with a cleaner workflow and a premium UI.

## Connection Modes
### 1) Local (Client REST API)
- Requires the **RIT User App** running on the same machine.
- Default endpoint: `http://localhost:9999`.
- Uses API key from the RIT app.

### 2) Remote (DMA REST API)
- Direct to RIT server (Instructor App).
- Default endpoint: `http://flserver.rotman.utoronto.ca:10001`.
- Uses **Basic Authorization** header.

## Why a Local Proxy is Required (CORS)
Browsers block cross‑origin requests unless the server explicitly allows them. The RIT servers do **not** send `Access-Control-Allow-Origin`, so direct calls from the browser are blocked.

**Solution:** use the local proxy bundled in this repo. It forwards requests to the RIT server and injects the CORS headers.

Flow:
- Browser → `http://localhost:3001` → RIT server

## Proxy Server (runs with dev server)
`npm run dev` starts **both**:
- Vite dev server
- Proxy server on `http://localhost:3001`

The UI has a **Use Proxy** toggle for both Local and Remote modes.

## Scripts (connection testing)
The `scripts/` folder contains small Python scripts used for API testing:
- `scripts/price_watch.py`
- `scripts/rit_rest_client.py`
- `scripts/speed_test.py`
- `scripts/test_remote.py`

Credentials are stored in `creds/` and **ignored by git**.
A blank template file is provided:
- `creds/rit_rest.example.jsonc`

## Performance Observations
- Practical tests show ~**2 requests/sec** on remote DMA.
- Official tools (native app + Excel) appear to operate at similar throughput.

## Setup
```bash
npm install
npm run dev
```

## Proxy (local or remote)
The remote DMA flow needs a proxy for CORS.
- Local: start `proxy.mjs` or `proxy.py`, then enable **Use proxy** in the UI.
- Remote: use a hosted proxy (e.g., Cloudflare Worker) and set **Remote proxy URL** in the UI.

## CI/CD (GitHub Pages via /docs)
This repo uses a commit-on-build workflow:
- On every push to `main`, GitHub Actions runs `npm run build`
- The build output is committed to `/docs`
- GitHub Pages should be configured to serve from the `/docs` folder on `main`

## Notes
- Local connection requires the Windows RIT User App running.
- Remote connection works without the app, using DMA credentials.

---

## API Coverage (Privod Implementation)
Below is what each endpoint does and how it’s wired in Privod.

### `/case` — case status
- **What it does:** returns current case/period/tick/status.
- **Privod:** fetched on connect to show status + case name.

### `/securities` — live quotes & positions
- **What it does:** list of securities with last/bid/ask/position.
- **Privod:** feeds the Market Snapshot + ticker list.

### `/securities/book` — order book
- **What it does:** top-of-book depth (bids/asks).
- **Privod:** live order book panel.

### `/securities/history` — OHLC candles
- **What it does:** historical OHLC by tick.
- **Privod:** Plotly candlesticks chart.

### `/orders` (GET/POST) — orders list + create
- **What it does:** lists open orders; places new orders.
- **Privod:** open orders panel + limit order entry form.

### `/orders/{id}` (DELETE)
- **What it does:** cancel a specific order.
- **Privod:** cancel buttons in the open orders list.

---

## API Toolkit (Advanced Endpoints)
These are implemented in the **API Toolkit** panel in the UI:

### `/trader`
- **What it does:** trader profile + NLV.
- **Privod:** “Load Trader” button shows JSON.

### `/limits`
- **What it does:** current risk limits and usage.
- **Privod:** “Load Limits” button shows JSON.

### `/news`
- **What it does:** news feed (since/limit).
- **Privod:** fetch + display JSON list.

### `/assets`
- **What it does:** list of assets available for leasing/conversion.
- **Privod:** “Load Assets” button.

### `/assets/history`
- **What it does:** asset activity log.
- **Privod:** ticker + limit filters, JSON output.

### `/securities/tas`
- **What it does:** time & sales tape.
- **Privod:** fetch with after/limit.

### `/orders/{id}` (GET)
- **What it does:** order detail lookup.
- **Privod:** order id lookup in toolkit.

### `/tenders`
- **What it does:** active tender offers.
- **Privod:** list + accept/decline buttons.

### `/tenders/{id}` (POST/DELETE)
- **What it does:** accept or decline a tender.
- **Privod:** accept/decline actions; price input for non-fixed bid.

### `/leases`
- **What it does:** list leases; create lease.
- **Privod:** list leases + create lease form.

### `/leases/{id}`
- **What it does:** get lease, use lease, unlease.
- **Privod:** lease id lookup + use/unlease actions.

### `/commands/cancel`
- **What it does:** bulk cancel open orders (all/ticker/ids/query).
- **Privod:** bulk cancel control with mode + value.

## Git Credentials Safety
Credentials are **not committed**. `scripts/creds/*` is in `.gitignore` and the template `rit_rest.example.jsonc` shows the exact JSON format.
