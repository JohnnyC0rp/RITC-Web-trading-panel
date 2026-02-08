# Sections Index

Fast-search map for major UI sections extracted from `App.jsx`.

- `OrderbookSection.jsx`
  - Responsibility: orderbook shell, multi-panel books, book/candle display modes, row-level mouse trading actions.
  - Search anchors: `display mode`, `handleBookOrder`, `book-center-hint`.

- `OpenOrdersCard.jsx`
  - Responsibility: open orders list and bracket details (SL/TP).
  - Search anchors: `SL`, `TP`, `Cancel`.

- `OpenPositionsCard.jsx`
  - Responsibility: open position snapshot with side, entry, and live PnL.
  - Search anchors: `position-side`, `position-pnl`.

## Why this folder exists

These section components keep high-churn UI blocks isolated, so both humans and AI agents can navigate/edit targeted features without loading the full `App.jsx` context each time.
