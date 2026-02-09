import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ApiLab from "./components/ApiLab";
import CandlesRenderer from "./components/charts/CandlesRenderer";
import MnaPairsSection from "./components/sections/MnaPairsSection";
import OpenOrdersCard from "./components/sections/OpenOrdersCard";
import OpenPositionsCard from "./components/sections/OpenPositionsCard";
import OrderbookSection from "./components/sections/OrderbookSection";
import {
  MNA_CASE_PAIRS,
  MNA_CASE_PAIR_BY_ID,
  MNA_DEFAULT_PAIR_IDS,
  deriveMnaTargetPrice,
  getMnaStartingPrice,
  sanitizeMnaPairIds,
} from "./components/sections/mnaPairsConfig";
import {
  CANDLE_RENDERERS,
  DEFAULT_CANDLE_RENDERER,
  getCandleRendererMeta,
  isKnownCandleRenderer,
} from "./components/charts/candleRenderers";
import "./App.css";

const encodeBasic = (username, password) =>
  `Basic ${btoa(`${username}:${password}`)}`;

const DEFAULT_LOCAL = {
  baseUrl: "http://localhost:9999",
  apiKey: "",
};

const DEFAULT_REMOTE = {
  baseUrl: "http://flserver.rotman.utoronto.ca:16530",
  authHeader: "",
  username: "",
  password: "",
  authMode: "basic",
  caseId: "volatility-trading",
  algoPort: 16565,
};

const DMA_CASES = [
  { id: "liquidity-risk", label: "Liquidity Risk", port: 16510 },
  { id: "volatility-trading", label: "Volatility Trading", port: 16530 },
  { id: "merger-arbitrage", label: "Merger Arbitrage", port: 16550 },
  { id: "algo-mm", label: "Algo MM", ports: [16565, 16575, 16585] },
];

const CONNECTION_PREFS_KEY = "privodJohnnyConnectionPrefs";
const UI_PREFS_KEY = "privodJohnnyUiPrefs";
const CHART_RENDERER_COOKIE_KEY = "privodJohnnyChartRenderer";
const CHART_AUTOSCALE_COOKIE_KEY = "privodJohnnyChartAutoScale";
const CHART_MOUSE_TRADING_COOKIE_KEY = "privodJohnnyChartMouseTrading";
const CHART_RANGE_SLIDER_COOKIE_KEY = "privodJohnnyChartRangeSlider";
const UPDATE_SEEN_KEY = "privodJohnnyLastUpdateSeen";
const TUTORIAL_SEEN_KEY = "privodJohnnyTutorialSeenV2";
const UPDATE_SOURCE_PATH = `${import.meta.env.BASE_URL}versions.txt`;
const UPDATE_SEPARATOR = "==================";

const FAST_POLL_MS = 300;
const INFO_POLL_MS = 600;
const POLL_INTERVALS_MS = {
  case: INFO_POLL_MS,
  book: FAST_POLL_MS,
  securities: FAST_POLL_MS,
  orders: FAST_POLL_MS,
  trader: 1000,
  tas: FAST_POLL_MS,
  fills: FAST_POLL_MS,
  tenders: FAST_POLL_MS,
  news: INFO_POLL_MS,
};
const NEWS_TTL_MS = 10000;
const BOOK_PANEL_PRIMARY_ID = "primary";
const MAX_BOOK_PANELS = 4;
const MAX_MNA_PAIR_PANELS = 12;
const MAX_PERF_POINTS = 80;
const FAST_POLL_ENDPOINTS = [
  { key: "GET /securities/book", label: "Order Book", pollMs: POLL_INTERVALS_MS.book },
  { key: "GET /securities/tas", label: "Time & Sales", pollMs: POLL_INTERVALS_MS.tas },
  { key: "GET /fills", label: "Fills", pollMs: POLL_INTERVALS_MS.fills },
  { key: "GET /orders", label: "Open Orders", pollMs: POLL_INTERVALS_MS.orders },
  { key: "GET /case", label: "Case", pollMs: POLL_INTERVALS_MS.case },
  { key: "GET /news", label: "News", pollMs: POLL_INTERVALS_MS.news },
];
const FAST_POLL_KEYS = new Set(FAST_POLL_ENDPOINTS.map((endpoint) => endpoint.key));
const BOOK_DEPTH_LIMIT = 1000;
const BOOK_POLL_MAX_MS = 1800;
const BOOK_POLL_BACKOFF_MS = 250;
const BOOK_ROW_HEIGHT_PX = 20;
const BOOK_EDGE_BUFFER_TICKS = 10;
const AUTO_CENTER_BOOK_ON_CONNECT = true; // Auto-centering is back; turns out the desk likes a tidy reset.
const PNL_TICK_STEP = 5;
const CANDLE_BUCKET = 5;
const ORDERBOOK_DISPLAY_OPTIONS = [
  { id: "book", label: "Order Book View" },
  { id: "graph", label: "Graph View" },
];
const DEFAULT_ORDERBOOK_DISPLAY = ORDERBOOK_DISPLAY_OPTIONS[0].id;
const DEFAULT_BRACKET_SETTINGS = {
  enabled: false,
  stopLossOffset: "0.30",
  takeProfitOffset: "0.60",
};
const buildMnaPeerVisibilityKey = (pairId, ticker) => `${pairId}:${ticker}`;

const INDICATORS = [
  {
    id: "sma20",
    label: "SMA 20",
    description: "Simple moving average of the last 20 closes; smooths noise and shows the short-term trend.",
    axis: "overlay",
  },
  {
    id: "sma50",
    label: "SMA 50",
    description: "Simple moving average of the last 50 closes; highlights medium-term direction and trend strength.",
    axis: "overlay",
  },
  {
    id: "sma100",
    label: "SMA 100",
    description: "Simple moving average of the last 100 closes; useful for spotting sustained moves over time.",
    axis: "overlay",
  },
  {
    id: "sma200",
    label: "SMA 200",
    description: "Simple moving average of the last 200 closes; classic long-term trend filter.",
    axis: "overlay",
  },
  {
    id: "ema9",
    label: "EMA 9",
    description: "Exponential moving average over 9 periods; reacts quickly to recent price changes.",
    axis: "overlay",
  },
  {
    id: "ema21",
    label: "EMA 21",
    description: "Exponential moving average over 21 periods; balances responsiveness and smoothness.",
    axis: "overlay",
  },
  {
    id: "ema50",
    label: "EMA 50",
    description: "Exponential moving average over 50 periods; tracks the intermediate trend with less lag.",
    axis: "overlay",
  },
  {
    id: "wma20",
    label: "WMA 20",
    description: "Weighted moving average over 20 periods; gives more weight to recent data for faster turns.",
    axis: "overlay",
  },
  {
    id: "dema20",
    label: "DEMA 20",
    description: "Double exponential moving average over 20 periods; reduces lag compared with standard EMA.",
    axis: "overlay",
  },
  {
    id: "bollinger",
    label: "Bollinger Bands",
    description:
      "SMA 20 with upper/lower bands at 2 standard deviations; flags volatility expansion and potential extremes.",
    axis: "overlay",
  },
  {
    id: "keltner",
    label: "Keltner Channels",
    description: "EMA 20 with ATR-based bands; smoother volatility envelope than Bollinger.",
    axis: "overlay",
  },
  {
    id: "donchian",
    label: "Donchian Channels",
    description: "Upper/lower channel from 20-period highest high and lowest low; useful for breakout tracking.",
    axis: "overlay",
  },
  {
    id: "rsi14",
    label: "RSI 14",
    description: "Relative Strength Index (0-100); gauges momentum and overbought/oversold conditions.",
    axis: "oscillator",
  },
  {
    id: "macd",
    label: "MACD",
    description: "EMA 12-26 difference with a 9-period signal line; tracks trend shifts and momentum.",
    axis: "oscillator",
  },
  {
    id: "stochastic",
    label: "Stochastic",
    description: "%K/%D oscillator based on recent highs/lows; compares close to range to spot momentum turns.",
    axis: "oscillator",
  },
  {
    id: "atr14",
    label: "ATR 14",
    description: "Average True Range over 14 periods; measures volatility without direction.",
    axis: "oscillator",
  },
  {
    id: "adx14",
    label: "ADX 14",
    description: "Average Directional Index over 14 periods; quantifies trend strength (higher = stronger).",
    axis: "oscillator",
  },
  {
    id: "cci20",
    label: "CCI 20",
    description: "Commodity Channel Index over 20 periods; highlights deviation from typical price.",
    axis: "oscillator",
  },
  {
    id: "roc12",
    label: "ROC 12",
    description: "Rate of Change over 12 periods; percentage momentum indicator.",
    axis: "oscillator",
  },
  {
    id: "williams14",
    label: "Williams %R",
    description: "Williams %R over 14 periods; fast oscillator of close vs. recent range.",
    axis: "oscillator",
  },
];

const INDICATOR_DEFAULTS = Object.fromEntries(INDICATORS.map((indicator) => [indicator.id, false]));
const OSCILLATOR_INDICATORS = INDICATORS.filter((indicator) => indicator.axis === "oscillator").map(
  (indicator) => indicator.id
);

const LOG_CATEGORIES = [
  { id: "request", label: "Requests" },
  { id: "order", label: "Orders" },
  { id: "strategy", label: "Strategy" },
  { id: "news", label: "News" },
  { id: "system", label: "System" },
  { id: "error", label: "Errors" },
];
const DEFAULT_LOG_FILTERS = LOG_CATEGORIES.map((category) => category.id);

const normalizeBaseUrl = (url) =>
  url.replace(/\/+$/, "").replace(/\/v1$/i, "").replace(/\/v1\/$/i, "");

const updateUrlPort = (rawUrl, port) => {
  try {
    const parsed = new URL(rawUrl);
    parsed.port = String(port);
    return parsed.toString();
  } catch {
    return rawUrl;
  }
};

const resolveCasePort = (caseId, algoPort) => {
  const entry = DMA_CASES.find((item) => item.id === caseId);
  if (!entry) return null;
  if (entry.ports) return algoPort ?? entry.ports[0];
  return entry.port ?? null;
};

const loadConnectionPrefs = () => {
  try {
    const raw = localStorage.getItem(CONNECTION_PREFS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const saveConnectionPrefs = (payload) => {
  try {
    localStorage.setItem(CONNECTION_PREFS_KEY, JSON.stringify(payload));
  } catch {
    // If storage is blocked, we keep calm and carry on. 🙂
  }
};

const readCookie = (name) => {
  if (typeof document === "undefined") return null;
  const encoded = `${name}=`;
  const chunks = document.cookie.split(";");
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith(encoded)) continue;
    return decodeURIComponent(trimmed.slice(encoded.length));
  }
  return null;
};

const writeCookie = (name, value, days = 365) => {
  if (typeof document === "undefined") return;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  // A little breadcrumb so the chosen chart survives refreshes.
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expiresAt.toUTCString()}; path=/; SameSite=Lax`;
};

const readBooleanCookie = (name) => {
  const raw = readCookie(name);
  if (raw == null) return null;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return null;
};

const writeBooleanCookie = (name, value) => {
  if (typeof value !== "boolean") return;
  writeCookie(name, value ? "1" : "0");
};

const loadUiPrefs = () => {
  let parsed = {};
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }

  if (!parsed.chartRenderer) {
    const cookieRenderer = readCookie(CHART_RENDERER_COOKIE_KEY);
    if (cookieRenderer && isKnownCandleRenderer(cookieRenderer)) {
      parsed.chartRenderer = cookieRenderer;
    }
  }

  if (typeof parsed.autoScaleCharts !== "boolean") {
    const cookieAutoScale = readBooleanCookie(CHART_AUTOSCALE_COOKIE_KEY);
    if (typeof cookieAutoScale === "boolean") parsed.autoScaleCharts = cookieAutoScale;
  }
  if (typeof parsed.chartMouseTrading !== "boolean") {
    const cookieMouseTrading = readBooleanCookie(CHART_MOUSE_TRADING_COOKIE_KEY);
    if (typeof cookieMouseTrading === "boolean") parsed.chartMouseTrading = cookieMouseTrading;
  }
  if (typeof parsed.showRangeSlider !== "boolean") {
    const cookieRangeSlider = readBooleanCookie(CHART_RANGE_SLIDER_COOKIE_KEY);
    if (typeof cookieRangeSlider === "boolean") parsed.showRangeSlider = cookieRangeSlider;
  }

  return Object.keys(parsed).length ? parsed : null;
};

const saveUiPrefs = (payload) => {
  const renderer = payload?.chartRenderer;
  const autoScaleCharts = payload?.autoScaleCharts;
  const chartMouseTrading = payload?.chartMouseTrading;
  const showRangeSlider = payload?.showRangeSlider;
  try {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(payload));
  } catch {
    // UI prefs are shy sometimes; we let them hide. 🙂
  }
  if (renderer && isKnownCandleRenderer(renderer)) {
    writeCookie(CHART_RENDERER_COOKIE_KEY, renderer);
  }
  writeBooleanCookie(CHART_AUTOSCALE_COOKIE_KEY, autoScaleCharts);
  writeBooleanCookie(CHART_MOUSE_TRADING_COOKIE_KEY, chartMouseTrading);
  writeBooleanCookie(CHART_RANGE_SLIDER_COOKIE_KEY, showRangeSlider);
};

const buildUrl = (baseUrl, path, params = {}) => {
  const normalized = normalizeBaseUrl(baseUrl);
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.append(key, String(value));
  });
  return `${normalized}/v1${path}${query.toString() ? `?${query}` : ""}`;
};

const safeJson = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const parseVersionHistory = (raw) => {
  if (!raw) return [];
  return raw
    .replace(/\r/g, "")
    .split(UPDATE_SEPARATOR)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const timestamp = lines.shift()?.trim();
      if (!timestamp) return null;
      const message = lines.join("\n").trim();
      return { timestamp, message };
    })
    .filter(Boolean);
};

const formatNumber = (value, decimals = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toFixed(decimals);
};

const firstFinite = (...values) => {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
};

const getOrderStopLoss = (order) =>
  firstFinite(
    order?.stop_loss,
    order?.stopLoss,
    order?.sl,
    order?.stop,
    order?.stopPrice
  );

const getOrderTakeProfit = (order) =>
  firstFinite(
    order?.take_profit,
    order?.takeProfit,
    order?.tp,
    order?.target,
    order?.target_price
  );

const formatPriceSet = (values, limit = 2) => {
  if (!values || !values.size) return null;
  const sorted = Array.from(values).sort((a, b) => Number(a) - Number(b));
  if (sorted.length <= limit) return sorted.join("/");
  const shown = sorted.slice(0, limit).join("/");
  return `${shown}+${sorted.length - limit}`;
};

const formatStamp = (date) => {
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3
  )}`;
};

const formatHumanDate = (raw) => {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  const day = parsed.getDate();
  const suffix =
    day % 10 === 1 && day % 100 !== 11
      ? "st"
      : day % 10 === 2 && day % 100 !== 12
        ? "nd"
        : day % 10 === 3 && day % 100 !== 13
          ? "rd"
          : "th";
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${day}${suffix} ${months[parsed.getMonth()]} ${parsed.getFullYear()}`;
};

const formatHost = (rawUrl) => {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return rawUrl;
  }
};

const formatQty = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(Number(value));
  return formatted.replace(/,/g, " ");
};

const numberSplitRegex = /(-?\d+(?:[.,]\d+)?)/g;
const numberTokenRegex = /^-?\d+(?:[.,]\d+)?$/;
const highlightNumbers = (text) => {
  if (text === null || text === undefined) return text;
  const value = String(text);
  const parts = value.split(numberSplitRegex);
  if (parts.length === 1) return value;
  return parts.map((part, index) =>
    numberTokenRegex.test(part) ? (
      <span key={`num-${index}`} className="number-highlight">
        {part}
      </span>
    ) : (
      part
    )
  );
};

const getQty = (level) =>
  level?.quantity ?? level?.qty ?? level?.size ?? level?.volume ?? null;

const getStepFromDecimals = (decimals) => {
  if (decimals === undefined || decimals === null) return 0.01;
  return 1 / Math.pow(10, decimals);
};

const toStepTick = (price, step) => Math.round(price / step);
const fromStepTick = (tick, step, decimals) =>
  Number((tick * step).toFixed(decimals));

const toBucketTick = (tick, bucketSize = CANDLE_BUCKET) => {
  if (!Number.isFinite(tick)) return tick;
  const bucket = Math.floor((tick - 1) / bucketSize);
  return bucket * bucketSize + Math.ceil(bucketSize / 2);
};

const aggregateCandles = (rows, bucketSize = CANDLE_BUCKET) => {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const sorted = [...rows].sort((a, b) => Number(a.tick ?? 0) - Number(b.tick ?? 0));
  const buckets = new Map();
  sorted.forEach((row) => {
    const tick = Number(row.tick ?? 0);
    if (!Number.isFinite(tick) || tick <= 0) return;
    const bucket = Math.floor((tick - 1) / bucketSize);
    const startTick = bucket * bucketSize + 1;
    const centerTick = startTick + Math.floor(bucketSize / 2);
    const existing = buckets.get(bucket);
    if (!existing) {
      buckets.set(bucket, {
        tick: centerTick,
        open: Number(row.open ?? row.close ?? row.price ?? 0),
        high: Number(row.high ?? row.close ?? row.price ?? 0),
        low: Number(row.low ?? row.close ?? row.price ?? 0),
        close: Number(row.close ?? row.price ?? 0),
      });
      return;
    }
    existing.high = Math.max(existing.high, Number(row.high ?? row.close ?? row.price ?? existing.high));
    existing.low = Math.min(existing.low, Number(row.low ?? row.close ?? row.price ?? existing.low));
    existing.close = Number(row.close ?? row.price ?? existing.close);
  });
  return Array.from(buckets.values()).sort((a, b) => a.tick - b.tick);
};

const buildPositionsFromFills = (fills) => {
  const positions = new Map();
  if (!Array.isArray(fills) || fills.length === 0) return positions;
  const sorted = [...fills].sort((a, b) => {
    const tickA = Number(a.tick ?? 0);
    const tickB = Number(b.tick ?? 0);
    if (tickA !== tickB) return tickA - tickB;
    return Number(a.order_id ?? 0) - Number(b.order_id ?? 0);
  });
  sorted.forEach((fill) => {
    const price = Number(fill.vwap ?? fill.price);
    const qty = Number(fill.quantity_filled ?? fill.quantity ?? fill.qty ?? 0);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || qty === 0) return;
    const side = String(fill.action || "").toUpperCase();
    const signed = side === "BUY" ? qty : -qty;
    const ticker = fill.ticker;
    const current = positions.get(ticker) || { qty: 0, avg: 0 };
    const sameSide = current.qty === 0 || Math.sign(current.qty) === Math.sign(signed);
    if (sameSide) {
      const newQty = current.qty + signed;
      const totalCost =
        Math.abs(current.qty) * current.avg + Math.abs(signed) * price;
      const avg = newQty === 0 ? 0 : totalCost / Math.abs(newQty);
      positions.set(ticker, { qty: newQty, avg });
      return;
    }
    const closing = Math.min(Math.abs(current.qty), Math.abs(signed));
    const remaining = Math.abs(signed) - closing;
    const newQty = current.qty + signed;
    if (remaining > 0) {
      positions.set(ticker, { qty: newQty, avg: price });
    } else {
      positions.set(ticker, { qty: newQty, avg: newQty === 0 ? 0 : current.avg });
    }
  });
  return positions;
};

const buildFillMarkersForTicker = (fills, ticker) => {
  if (!Array.isArray(fills) || !fills.length || !ticker) {
    return { opens: [], closes: [] };
  }
  const filtered = fills
    .filter(
      (fill) =>
        fill.ticker === ticker &&
        Number.isFinite(Number(fill.tick)) &&
        Number.isFinite(Number(fill.vwap ?? fill.price))
    )
    .sort((a, b) => {
      const tickA = Number(a.tick ?? 0);
      const tickB = Number(b.tick ?? 0);
      if (tickA !== tickB) return tickA - tickB;
      return Number(a.order_id ?? 0) - Number(b.order_id ?? 0);
    });
  const opens = [];
  const closes = [];
  let position = 0;
  filtered.forEach((fill) => {
    const qty = Number(fill.quantity_filled ?? fill.quantity ?? fill.qty ?? 0);
    const signed = fill.action === "BUY" ? qty : -qty;
    const before = position;
    position += signed;
    if (before === 0 && position !== 0) {
      opens.push(fill);
    }
    if (position === 0 && before !== 0) {
      closes.push(fill);
    }
    if ((before > 0 && position < 0) || (before < 0 && position > 0)) {
      closes.push(fill);
      opens.push(fill);
    }
  });
  return { opens, closes };
};

const buildOrderLevelsForTicker = ({
  orders,
  ticker,
  decimals,
  includeRiskLevels = true,
}) => {
  if (!ticker) {
    return { limit: [], stopLoss: [], takeProfit: [] };
  }
  const limitByKey = new Map();
  const stopByKey = new Map();
  const takeByKey = new Map();
  orders.forEach((order) => {
    if (order?.ticker !== ticker) return;
    const side = String(order.action || "").toUpperCase() === "SELL" ? "SELL" : "BUY";
    const type = String(order.type || "").toUpperCase();
    const orderPrice = firstFinite(order?.price);
    const stopLoss = getOrderStopLoss(order);
    const takeProfit = getOrderTakeProfit(order);

    if (type === "LIMIT" && orderPrice != null) {
      const level = Number(orderPrice).toFixed(decimals);
      const key = `${side}:${level}`;
      const existing = limitByKey.get(key) || { price: Number(level), side, count: 0 };
      existing.count += 1;
      limitByKey.set(key, existing);
    }
    if (includeRiskLevels && stopLoss != null) {
      const key = Number(stopLoss).toFixed(decimals);
      const existing = stopByKey.get(key) || { price: Number(key), count: 0 };
      existing.count += 1;
      stopByKey.set(key, existing);
    }
    if (includeRiskLevels && takeProfit != null) {
      const key = Number(takeProfit).toFixed(decimals);
      const existing = takeByKey.get(key) || { price: Number(key), count: 0 };
      existing.count += 1;
      takeByKey.set(key, existing);
    }
  });
  return {
    limit: Array.from(limitByKey.values()).sort((a, b) => a.price - b.price),
    stopLoss: Array.from(stopByKey.values()).sort((a, b) => a.price - b.price),
    takeProfit: Array.from(takeByKey.values()).sort((a, b) => a.price - b.price),
  };
};

const calcSMA = (values, window) => {
  const result = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i + 1 < window) {
      result.push(null);
      continue;
    }
    const slice = values.slice(i + 1 - window, i + 1);
    if (slice.some((value) => !Number.isFinite(value))) {
      result.push(null);
      continue;
    }
    const avg = slice.reduce((sum, value) => sum + value, 0) / window;
    result.push(Number(avg.toFixed(4)));
  }
  return result;
};

const calcEMA = (values, window) => {
  const k = 2 / (window + 1);
  const result = [];
  let ema = null;
  const seed = [];
  values.forEach((value) => {
    if (!Number.isFinite(value)) {
      result.push(null);
      return;
    }
    if (ema === null) {
      seed.push(value);
      if (seed.length < window) {
        result.push(null);
        return;
      }
      const avg = seed.reduce((sum, entry) => sum + entry, 0) / window;
      ema = avg;
      result.push(Number(ema.toFixed(4)));
      return;
    }
    // We smooth the EMA because price already brings enough drama.
    ema = value * k + ema * (1 - k);
    result.push(Number(ema.toFixed(4)));
  });
  return result;
};

const calcRSI = (values, window) => {
  const result = Array(values.length).fill(null);
  if (values.length <= window) return result;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= window; i += 1) {
    const diff = values[i] - values[i - 1];
    if (!Number.isFinite(diff)) continue;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / window;
  let avgLoss = losses / window;
  if (Number.isFinite(avgGain) && Number.isFinite(avgLoss)) {
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    result[window] = Number((100 - 100 / (1 + rs)).toFixed(4));
  }
  for (let i = window + 1; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    if (!Number.isFinite(diff)) {
      result[i] = null;
      continue;
    }
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (window - 1) + gain) / window;
    avgLoss = (avgLoss * (window - 1) + loss) / window;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    result[i] = Number((100 - 100 / (1 + rs)).toFixed(4));
  }
  return result;
};

const calcWMA = (values, window) => {
  const result = [];
  const denom = (window * (window + 1)) / 2;
  for (let i = 0; i < values.length; i += 1) {
    if (i + 1 < window) {
      result.push(null);
      continue;
    }
    const slice = values.slice(i + 1 - window, i + 1);
    if (slice.some((value) => !Number.isFinite(value))) {
      result.push(null);
      continue;
    }
    let sum = 0;
    for (let j = 0; j < window; j += 1) {
      sum += slice[j] * (j + 1);
    }
    result.push(Number((sum / denom).toFixed(4)));
  }
  return result;
};

const calcStdDev = (values, window) => {
  const result = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i + 1 < window) {
      result.push(null);
      continue;
    }
    const slice = values.slice(i + 1 - window, i + 1);
    if (slice.some((value) => !Number.isFinite(value))) {
      result.push(null);
      continue;
    }
    const mean = slice.reduce((sum, value) => sum + value, 0) / window;
    const variance = slice.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / window;
    result.push(Number(Math.sqrt(variance).toFixed(4)));
  }
  return result;
};

const calcDEMA = (values, window) => {
  const ema1 = calcEMA(values, window);
  const ema2 = calcEMA(ema1, window);
  return ema1.map((value, index) => {
    const second = ema2[index];
    if (!Number.isFinite(value) || !Number.isFinite(second)) return null;
    return Number((2 * value - second).toFixed(4));
  });
};

const calcATR = (highs, lows, closes, window) => {
  const tr = highs.map((high, index) => {
    const low = lows[index];
    const close = closes[index];
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) return null;
    const prevClose = index > 0 ? closes[index - 1] : close;
    if (!Number.isFinite(prevClose)) return null;
    const range = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    return Number(range.toFixed(4));
  });
  return calcEMA(tr, window);
};

const calcStochastic = (highs, lows, closes, kWindow, dWindow) => {
  const kValues = [];
  for (let i = 0; i < closes.length; i += 1) {
    if (i + 1 < kWindow) {
      kValues.push(null);
      continue;
    }
    const highSlice = highs.slice(i + 1 - kWindow, i + 1);
    const lowSlice = lows.slice(i + 1 - kWindow, i + 1);
    if (highSlice.some((value) => !Number.isFinite(value)) || lowSlice.some((value) => !Number.isFinite(value))) {
      kValues.push(null);
      continue;
    }
    const highestHigh = Math.max(...highSlice);
    const lowestLow = Math.min(...lowSlice);
    const denom = highestHigh - lowestLow;
    if (!Number.isFinite(denom) || denom === 0 || !Number.isFinite(closes[i])) {
      kValues.push(null);
      continue;
    }
    const value = ((closes[i] - lowestLow) / denom) * 100;
    kValues.push(Number(value.toFixed(4)));
  }
  const dValues = calcSMA(kValues, dWindow);
  return { k: kValues, d: dValues };
};

const calcADX = (highs, lows, closes, window) => {
  const plusDM = [];
  const minusDM = [];
  const tr = [];
  for (let i = 0; i < highs.length; i += 1) {
    if (i === 0) {
      plusDM.push(null);
      minusDM.push(null);
      tr.push(null);
      continue;
    }
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    const plus = upMove > downMove && upMove > 0 ? upMove : 0;
    const minus = downMove > upMove && downMove > 0 ? downMove : 0;
    plusDM.push(Number(plus.toFixed(4)));
    minusDM.push(Number(minus.toFixed(4)));
    const prevClose = closes[i - 1];
    const range = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - prevClose),
      Math.abs(lows[i] - prevClose)
    );
    tr.push(Number(range.toFixed(4)));
  }
  const smoothedTR = calcEMA(tr, window);
  const smoothedPlus = calcEMA(plusDM, window);
  const smoothedMinus = calcEMA(minusDM, window);
  const dx = smoothedTR.map((range, index) => {
    const plus = smoothedPlus[index];
    const minus = smoothedMinus[index];
    if (!Number.isFinite(range) || range === 0 || !Number.isFinite(plus) || !Number.isFinite(minus)) {
      return null;
    }
    const plusDI = (100 * plus) / range;
    const minusDI = (100 * minus) / range;
    const sum = plusDI + minusDI;
    if (!Number.isFinite(sum) || sum === 0) return null;
    return Number(((100 * Math.abs(plusDI - minusDI)) / sum).toFixed(4));
  });
  return calcEMA(dx, window);
};

const calcCCI = (highs, lows, closes, window) => {
  const typical = highs.map((high, index) => {
    const low = lows[index];
    const close = closes[index];
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) return null;
    return (high + low + close) / 3;
  });
  const sma = calcSMA(typical, window);
  return typical.map((value, index) => {
    if (!Number.isFinite(value) || !Number.isFinite(sma[index])) return null;
    if (index + 1 < window) return null;
    const slice = typical.slice(index + 1 - window, index + 1);
    if (slice.some((entry) => !Number.isFinite(entry))) return null;
    const meanDev =
      slice.reduce((sum, entry) => sum + Math.abs(entry - sma[index]), 0) / window;
    if (!Number.isFinite(meanDev) || meanDev === 0) return null;
    return Number(((value - sma[index]) / (0.015 * meanDev)).toFixed(4));
  });
};

const calcROC = (values, window) => {
  return values.map((value, index) => {
    if (index < window) return null;
    const prev = values[index - window];
    if (!Number.isFinite(value) || !Number.isFinite(prev) || prev === 0) return null;
    return Number((((value - prev) / prev) * 100).toFixed(4));
  });
};

const calcWilliamsR = (highs, lows, closes, window) => {
  return closes.map((close, index) => {
    if (index + 1 < window) return null;
    const highSlice = highs.slice(index + 1 - window, index + 1);
    const lowSlice = lows.slice(index + 1 - window, index + 1);
    if (highSlice.some((value) => !Number.isFinite(value)) || lowSlice.some((value) => !Number.isFinite(value))) {
      return null;
    }
    const highestHigh = Math.max(...highSlice);
    const lowestLow = Math.min(...lowSlice);
    const denom = highestHigh - lowestLow;
    if (!Number.isFinite(denom) || denom === 0 || !Number.isFinite(close)) return null;
    return Number((((highestHigh - close) / denom) * -100).toFixed(4));
  });
};

const calcDonchian = (highs, lows, window) => {
  const upper = [];
  const lower = [];
  for (let i = 0; i < highs.length; i += 1) {
    if (i + 1 < window) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    const highSlice = highs.slice(i + 1 - window, i + 1);
    const lowSlice = lows.slice(i + 1 - window, i + 1);
    if (highSlice.some((value) => !Number.isFinite(value)) || lowSlice.some((value) => !Number.isFinite(value))) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    upper.push(Number(Math.max(...highSlice).toFixed(4)));
    lower.push(Number(Math.min(...lowSlice).toFixed(4)));
  }
  return { upper, lower };
};

const calcKeltner = (highs, lows, closes, window, multiplier) => {
  const typical = highs.map((high, index) => {
    const low = lows[index];
    const close = closes[index];
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) return null;
    return (high + low + close) / 3;
  });
  const middle = calcEMA(typical, window);
  const atr = calcATR(highs, lows, closes, window);
  const upper = middle.map((value, index) => {
    const range = atr[index];
    if (!Number.isFinite(value) || !Number.isFinite(range)) return null;
    return Number((value + multiplier * range).toFixed(4));
  });
  const lower = middle.map((value, index) => {
    const range = atr[index];
    if (!Number.isFinite(value) || !Number.isFinite(range)) return null;
    return Number((value - multiplier * range).toFixed(4));
  });
  return { upper, middle, lower };
};

const calcMACD = (values, fastWindow, slowWindow, signalWindow) => {
  const fast = calcEMA(values, fastWindow);
  const slow = calcEMA(values, slowWindow);
  const macd = fast.map((value, index) => {
    const slowValue = slow[index];
    if (!Number.isFinite(value) || !Number.isFinite(slowValue)) return null;
    return Number((value - slowValue).toFixed(4));
  });
  const signal = calcEMA(macd, signalWindow);
  return { macd, signal };
};

const getVolumeTone = (ratio) => {
  if (ratio >= 0.6) return "deep";
  if (ratio >= 0.3) return "mid";
  if (ratio > 0) return "light";
  return "none";
};

function App() {
  const logoUrl = `${import.meta.env.BASE_URL}logo-transparent.png`;
  const [mode, setMode] = useState("remote");
  const [localConfig, setLocalConfig] = useState(DEFAULT_LOCAL);
  const [remoteConfig, setRemoteConfig] = useState(DEFAULT_REMOTE);
  const [activeConfig, setActiveConfig] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("Disconnected");
  const [connectionError, setConnectionError] = useState("");
  const [proxyHint, setProxyHint] = useState("");

  const [caseInfo, setCaseInfo] = useState(null);
  const [securities, setSecurities] = useState([]);
  const [selectedTicker, setSelectedTicker] = useState("");
  const [booksByTicker, setBooksByTicker] = useState({});
  const [bookAnchors, setBookAnchors] = useState({});
  const [bookExtraRows, setBookExtraRows] = useState({});
  const [history, setHistory] = useState([]);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const [orders, setOrders] = useState([]);
  const [realizedSeries, setRealizedSeries] = useState([]);
  const [unrealizedSeries, setUnrealizedSeries] = useState([]);
  const [fills, setFills] = useState([]);
  const [tasTrades, setTasTrades] = useState([]);
  const [demoStrategy, setDemoStrategy] = useState({
    enabled: false,
    intervalMs: 3000,
    quantity: 1,
    maxPos: 50,
  });
  const [terminalUnlocked, setTerminalUnlocked] = useState(false);
  const [showTerminalPrompt, setShowTerminalPrompt] = useState(false);
  const [terminalLines, setTerminalLines] = useState([]);
  const [logFilters, setLogFilters] = useState(DEFAULT_LOG_FILTERS);
  const [requestMetrics, setRequestMetrics] = useState({});
  const [perfSeries, setPerfSeries] = useState({});
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [updatePayload, setUpdatePayload] = useState(null);
  const [versionMajor, setVersionMajor] = useState(0);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [lastBookUpdateAt, setLastBookUpdateAt] = useState(0);
  const [lastConnectAt, setLastConnectAt] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [newsItems, setNewsItems] = useState([]);
  const [dismissedNewsIds, setDismissedNewsIds] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [tenderPrices, setTenderPrices] = useState({});
  const bookScrollRef = useRef(null);
  const bookScrollRefs = useRef({});
  const bookCenterRef = useRef({
    connectAt: null,
    caseKey: null,
    tick1Period: null,
    idleAt: null,
  });
  const bookAnchorRef = useRef({
    connectAt: null,
    caseKey: null,
    tick1Period: null,
    idleAt: null,
  });
  const openOrdersRef = useRef([]);
  const cancelledOrdersRef = useRef(new Map());
  const orderTypeByIdRef = useRef(new Map());
  const bracketByOrderIdRef = useRef(new Map());
  const pendingPlacementsRef = useRef([]);
  const seenFillIdsRef = useRef(new Set());
  const filledOrderIdsRef = useRef(new Set());
  const lastCaseRef = useRef({ tick: null, period: null });
  const tickAlertRef = useRef({ period: null, fired: new Set() });
  const tasAfterRef = useRef(null);
  const marketSnapRef = useRef({
    last: null,
    mid: null,
    position: 0,
    bestBid: null,
    bestAsk: null,
  });
  const audioRef = useRef(null);
  const newsSinceRef = useRef(null);
  const tenderIdsRef = useRef(new Set());
  const hadStaleRef = useRef(false);
  const bookExtraRowsRef = useRef({});
  const pnlUpdateRef = useRef({ tick: null, realized: null, unrealized: null });
  const terminalBodyRef = useRef(null);
  const clearNewsSortKeyRef = useRef(null);
  const endpointRateLimitUntilRef = useRef(new Map());
  const mnaGraphDefaultRef = useRef(null);
  const chartTradingHintAtRef = useRef(0);
  const [useProxyLocal, setUseProxyLocal] = useState(false);
  const [useProxyRemote, setUseProxyRemote] = useState(true);
  const [proxyTargetRemote, setProxyTargetRemote] = useState("remote");
  const [localProxyUrl, setLocalProxyUrl] = useState("http://localhost:3001");
  const [cloudProxyUrl, setCloudProxyUrl] = useState(
    "https://privod-johnny-ritc-api-cors-proxy.matveyrotte.workers.dev"
  );
  const [prefsHydrated, setPrefsHydrated] = useState(false);
  const [uiPrefsHydrated, setUiPrefsHydrated] = useState(false);
  const [chartView, setChartView] = useState({});
  const [chartRenderer, setChartRenderer] = useState(DEFAULT_CANDLE_RENDERER);
  const [showChartSettings, setShowChartSettings] = useState(false);
  const [chartMouseTrading, setChartMouseTrading] = useState(true);
  const [autoScaleCharts, setAutoScaleCharts] = useState(false);
  const [showRangeSlider, setShowRangeSlider] = useState(false);
  const [indicatorState, setIndicatorState] = useState(INDICATOR_DEFAULTS);
  const [indicatorInfo, setIndicatorInfo] = useState(null);
  const [theme, setTheme] = useState("light");
  const [bookView, setBookView] = useState("book");
  const [orderbookDisplayMode, setOrderbookDisplayMode] = useState(DEFAULT_ORDERBOOK_DISPLAY);
  const [bracketDefaults, setBracketDefaults] = useState(DEFAULT_BRACKET_SETTINGS);
  const [bookPanels, setBookPanels] = useState([{ id: BOOK_PANEL_PRIMARY_ID, ticker: "" }]);
  const [bookHistoryByTicker, setBookHistoryByTicker] = useState({});
  const [mnaPairIds, setMnaPairIds] = useState([...MNA_DEFAULT_PAIR_IDS]);
  const [mnaPeerPriceVisibility, setMnaPeerPriceVisibility] = useState({});
  const [mnaHistoryByTicker, setMnaHistoryByTicker] = useState({});
  const plotlyYRangeLocksRef = useRef(new Map());

  const [orderDraft, setOrderDraft] = useState({
    ticker: "",
    side: "BUY",
    quantity: "100",
    price: "",
  });

  // App bootstrap and persisted preference hydration.
  useEffect(() => {
    document.title = "Privod Johnny";
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let alive = true;
    const loadUpdate = async () => {
      try {
        const response = await fetch(UPDATE_SOURCE_PATH, { cache: "no-store" });
        if (!response.ok) return;
        const raw = await response.text();
        const updates = parseVersionHistory(raw);
        if (!alive) return;
        setVersionMajor(updates.length);
        if (!updates.length) return;
        const latest = updates[0];
        let seenStamp = null;
        try {
          seenStamp = localStorage.getItem(UPDATE_SEEN_KEY);
        } catch {
          // If storage is blocked, we politely move on.
        }
        if (seenStamp !== latest.timestamp) {
          setUpdatePayload({ latest, updates });
          setShowUpdatePrompt(true);
        }
      } catch {
        // No update available, no drama required.
      }
    };
    loadUpdate();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const stored = loadConnectionPrefs();
    if (stored) {
      if (stored.mode) setMode(stored.mode);
      if (typeof stored.useProxyLocal === "boolean") setUseProxyLocal(stored.useProxyLocal);
      if (typeof stored.useProxyRemote === "boolean") setUseProxyRemote(stored.useProxyRemote);
      if (stored.proxyTargetRemote) setProxyTargetRemote(stored.proxyTargetRemote);
      if (stored.localProxyUrl) setLocalProxyUrl(stored.localProxyUrl);
      if (stored.cloudProxyUrl) setCloudProxyUrl(stored.cloudProxyUrl);
      if (stored.localConfig) {
        setLocalConfig((prev) => ({ ...prev, ...stored.localConfig }));
      }
      if (stored.remoteConfig) {
        setRemoteConfig((prev) => ({ ...prev, ...stored.remoteConfig }));
      }
    }
    setPrefsHydrated(true);
    try {
      const seen = localStorage.getItem(TUTORIAL_SEEN_KEY);
      if (!seen) {
        setShowTutorial(true);
      }
    } catch {
      // If storage is blocked, we assume the tutorial is helpful once. 🙂
      setShowTutorial(true);
    }
  }, []);

  useEffect(() => {
    const stored = loadUiPrefs();
    if (stored) {
      if (stored.theme) setTheme(stored.theme);
      if (stored.chartRenderer && isKnownCandleRenderer(stored.chartRenderer)) {
        setChartRenderer(stored.chartRenderer);
      }
      if (typeof stored.chartMouseTrading === "boolean") {
        setChartMouseTrading(stored.chartMouseTrading);
      }
      if (typeof stored.autoScaleCharts === "boolean") {
        setAutoScaleCharts(stored.autoScaleCharts);
      }
      if (typeof stored.showRangeSlider === "boolean") setShowRangeSlider(stored.showRangeSlider);
      if (typeof stored.showChartSettings === "boolean") setShowChartSettings(stored.showChartSettings);
      if (stored.bookView) setBookView(stored.bookView);
      const normalizedDisplayMode =
        stored.orderbookDisplayMode === "candles"
          ? "graph"
          : stored.orderbookDisplayMode === "books" || stored.orderbookDisplayMode === "both"
            ? "book"
            : stored.orderbookDisplayMode;
      if (
        normalizedDisplayMode &&
        ORDERBOOK_DISPLAY_OPTIONS.some((option) => option.id === normalizedDisplayMode)
      ) {
        setOrderbookDisplayMode(normalizedDisplayMode);
      }
      if (stored.bracketDefaults) {
        setBracketDefaults((prev) => ({
          ...prev,
          ...stored.bracketDefaults,
          // Default to disabled on load; SL/TP can be re-enabled for the session when needed.
          enabled: false,
        }));
      }
      if (stored.quickOrderQuantity != null) {
        setOrderDraft((prev) => ({
          ...prev,
          quantity: String(stored.quickOrderQuantity),
        }));
      }
      if (Array.isArray(stored.logFilters) && stored.logFilters.length) {
        setLogFilters(stored.logFilters);
      }
      if (stored.indicators) {
        setIndicatorState((prev) => ({
          ...prev,
          ...stored.indicators,
        }));
      }
      if (Array.isArray(stored.mnaPairIds) && stored.mnaPairIds.length) {
        setMnaPairIds(sanitizeMnaPairIds(stored.mnaPairIds));
      }
      if (stored.mnaPeerPriceVisibility && typeof stored.mnaPeerPriceVisibility === "object") {
        setMnaPeerPriceVisibility(stored.mnaPeerPriceVisibility);
      }
    }
    setUiPrefsHydrated(true);
  }, []);

  useEffect(() => {
    if (!prefsHydrated) return;
    const payload = {
      mode,
      useProxyLocal,
      useProxyRemote,
      proxyTargetRemote,
      localProxyUrl,
      cloudProxyUrl,
      localConfig,
      remoteConfig,
    };
    saveConnectionPrefs(payload);
    // Yes Johnny, we save it all so you don't have to retype it. 🙂
  }, [
    cloudProxyUrl,
    localProxyUrl,
    localConfig,
    mode,
    proxyTargetRemote,
    prefsHydrated,
    remoteConfig,
    useProxyLocal,
    useProxyRemote,
  ]);

  useEffect(() => {
    if (!uiPrefsHydrated) return;
    saveUiPrefs({
      theme,
      chartRenderer,
      chartMouseTrading,
      autoScaleCharts,
      showRangeSlider,
      showChartSettings,
      bookView,
      orderbookDisplayMode,
      bracketDefaults,
      quickOrderQuantity: orderDraft.quantity,
      logFilters,
      indicators: indicatorState,
      mnaPairIds,
      mnaPeerPriceVisibility,
    });
  }, [
    autoScaleCharts,
    bookView,
    bracketDefaults,
    chartRenderer,
    chartMouseTrading,
    indicatorState,
    logFilters,
    orderDraft.quantity,
    orderbookDisplayMode,
    showChartSettings,
    showRangeSlider,
    mnaPairIds,
    mnaPeerPriceVisibility,
    theme,
    uiPrefsHydrated,
  ]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const config = useMemo(() => {
    if (!activeConfig) return null;
    return {
      ...activeConfig,
      baseUrl: normalizeBaseUrl(activeConfig.baseUrl),
    };
  }, [activeConfig]);

  const log = useCallback((message, category = "system") => {
    const stamp = formatStamp(new Date());
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      stamp,
      message,
      category,
    };
    setTerminalLines((prev) => {
      const next = [...prev, entry];
      return next.slice(-100);
    });
  }, []);

  const playSound = useCallback((tone = "notify") => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!audioRef.current) {
        audioRef.current = new AudioContext();
      }
      const ctx = audioRef.current;
      if (ctx.state === "suspended") {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      const presets = {
        notify: { freq: 660, type: "sine", gain: 0.06, duration: 0.12 },
        connect: { freq: 520, type: "sine", gain: 0.06, duration: 0.16 },
        tender: { freq: 980, type: "triangle", gain: 0.06, duration: 0.14 },
        alert: { freq: 880, type: "square", gain: 0.07, duration: 0.18 },
        news: { freq: 740, type: "sawtooth", gain: 0.05, duration: 0.2 },
        limitPlaced: { freq: 640, type: "triangle", gain: 0.05, duration: 0.1 },
        limitFilled: { freq: 760, type: "triangle", gain: 0.06, duration: 0.14 },
        marketPlaced: { freq: 540, type: "square", gain: 0.05, duration: 0.1 },
        marketFilled: { freq: 680, type: "square", gain: 0.06, duration: 0.14 },
        tickShort: { freq: 620, type: "sine", gain: 0.05, duration: 0.06 },
        tickMid: { freq: 680, type: "sine", gain: 0.05, duration: 0.1 },
        tickLong: { freq: 720, type: "sine", gain: 0.05, duration: 0.28 },
      };
      const preset = presets[tone] || presets.notify;
      osc.type = preset.type;
      osc.frequency.value = preset.freq;
      gain.gain.value = preset.gain;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + preset.duration);
    } catch {
      // If autoplay is blocked, we stay silent.
    }
  }, []);

  const notify = useCallback(
    (message, tone = "info", sound = "notify") => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setNotifications((prev) => [...prev, { id, message, tone }]);
      playSound(sound);
      setTimeout(() => {
        setNotifications((prev) => prev.filter((item) => item.id !== id));
      }, 4200);
    },
    [playSound]
  );

  const isMergerArbCase = useMemo(() => {
    if (mode === "remote" && remoteConfig.caseId === "merger-arbitrage") {
      return true;
    }
    const label = `${caseInfo?.name ?? ""} ${caseInfo?.case_id ?? ""} ${caseInfo?.case ?? ""}`.toLowerCase();
    return label.includes("merger") && label.includes("arbitrage");
  }, [caseInfo?.case, caseInfo?.case_id, caseInfo?.name, mode, remoteConfig.caseId]);

  useEffect(() => {
    if (!uiPrefsHydrated) return;
    if (!isMergerArbCase) {
      mnaGraphDefaultRef.current = null;
      return;
    }
    const caseKey =
      caseInfo?.name ??
      caseInfo?.case_id ??
      caseInfo?.case ??
      remoteConfig.caseId ??
      "merger-arbitrage";
    if (mnaGraphDefaultRef.current === caseKey) return;
    mnaGraphDefaultRef.current = caseKey;
    setOrderbookDisplayMode("graph");
  }, [
    caseInfo?.case,
    caseInfo?.case_id,
    caseInfo?.name,
    isMergerArbCase,
    remoteConfig.caseId,
    uiPrefsHydrated,
  ]);

  const activeMnaPairIds = useMemo(
    () => sanitizeMnaPairIds(mnaPairIds),
    [mnaPairIds]
  );

  const activeMnaPairs = useMemo(
    () =>
      activeMnaPairIds
        .map((pairId) => MNA_CASE_PAIR_BY_ID.get(pairId))
        .filter(Boolean),
    [activeMnaPairIds]
  );

  const canAddMnaPair = activeMnaPairIds.length < MAX_MNA_PAIR_PANELS;

  const addMnaPair = useCallback(() => {
    setMnaPairIds((prev) => {
      const sanitized = sanitizeMnaPairIds(prev);
      if (sanitized.length >= MAX_MNA_PAIR_PANELS) {
        notify(`Max ${MAX_MNA_PAIR_PANELS} pair panels reached.`, "info");
        return sanitized;
      }
      const nextPair = MNA_CASE_PAIRS[sanitized.length % MNA_CASE_PAIRS.length];
      return nextPair ? [...sanitized, nextPair.id] : sanitized;
    });
  }, [notify]);

  const updateMnaPairAt = useCallback((index, nextPairId) => {
    setMnaPairIds((prev) => {
      const sanitized = sanitizeMnaPairIds(prev);
      if (!MNA_CASE_PAIR_BY_ID.has(nextPairId)) return sanitized;
      const next = [...sanitized];
      if (index < 0 || index >= next.length) return sanitized;
      next[index] = nextPairId;
      return next;
    });
  }, []);

  const removeMnaPairAt = useCallback(
    (index) => {
      setMnaPairIds((prev) => {
        const sanitized = sanitizeMnaPairIds(prev);
        if (sanitized.length <= 1) {
          notify("At least one M&A pair should stay visible.", "info");
          return sanitized;
        }
        return sanitized.filter((_, itemIndex) => itemIndex !== index);
      });
    },
    [notify]
  );

  const isMnaPeerPriceVisible = useCallback(
    (pairId, ticker) => {
      const key = buildMnaPeerVisibilityKey(pairId, ticker);
      if (!Object.prototype.hasOwnProperty.call(mnaPeerPriceVisibility, key)) return true;
      return Boolean(mnaPeerPriceVisibility[key]);
    },
    [mnaPeerPriceVisibility]
  );

  const setMnaPeerPriceVisible = useCallback((pairId, ticker, nextValue) => {
    const key = buildMnaPeerVisibilityKey(pairId, ticker);
    setMnaPeerPriceVisibility((prev) => ({
      ...prev,
      [key]: Boolean(nextValue),
    }));
  }, []);

  const addBookPanel = useCallback(() => {
    setBookPanels((prev) => {
      if (prev.length >= MAX_BOOK_PANELS) {
        // Too many books and the desk starts to wobble. 📚
        notify(`Max ${MAX_BOOK_PANELS} order books reached.`, "info");
        return prev;
      }
      const used = new Set(prev.map((panel) => panel.ticker).filter(Boolean));
      const nextTicker =
        securities.find((sec) => sec.ticker && !used.has(sec.ticker))?.ticker ||
        selectedTicker ||
        securities[0]?.ticker ||
        "";
      if (!nextTicker) return prev;
      return [
        ...prev,
        { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, ticker: nextTicker },
      ];
    });
  }, [notify, securities, selectedTicker]);

  const updateBookPanelTicker = useCallback(
    (panelId, ticker) => {
      if (!ticker) return;
      if (panelId === BOOK_PANEL_PRIMARY_ID) {
        setSelectedTicker(ticker);
        return;
      }
      setBookPanels((prev) =>
        prev.map((panel) => (panel.id === panelId ? { ...panel, ticker } : panel))
      );
    },
    [setSelectedTicker]
  );

  const removeBookPanel = useCallback((panelId) => {
    if (panelId === BOOK_PANEL_PRIMARY_ID) return;
    setBookPanels((prev) => prev.filter((panel) => panel.id !== panelId));
  }, []);

  const toggleLogFilter = useCallback((filterId) => {
    setLogFilters((prev) => {
      if (prev.includes(filterId)) {
        return prev.filter((item) => item !== filterId);
      }
      return [...prev, filterId];
    });
  }, []);

  const enableAllLogFilters = useCallback(() => {
    setLogFilters(DEFAULT_LOG_FILTERS);
  }, []);

  const dismissNews = useCallback((id) => {
    setDismissedNewsIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const requestWithConfig = useCallback(
    async (cfg, path, params, options = {}) => {
      const mergedParams = {
        ...(cfg.params || {}),
        ...(params || {}),
      };
      const url = buildUrl(cfg.baseUrl, path, mergedParams);
      const headers = {
        Accept: "application/json",
        ...(cfg.headers || {}),
        ...(options.headers || {}),
      };
      const method = (options.method || "GET").toUpperCase();
      const requestKey = `${method} ${path}`;
      const nowMs = Date.now();
      const cooldownUntil = endpointRateLimitUntilRef.current.get(requestKey) || 0;
      if (cooldownUntil > nowMs) {
        const error = new Error("HTTP 429");
        error.status = 429;
        error.__silent = true;
        throw error;
      }
      const startedAt = performance.now();
      const recordMetric = (status, durationMs) => {
        setRequestMetrics((prev) => {
          const existing = prev[requestKey] || {
            count: 0,
            totalMs: 0,
            avgMs: 0,
            lastMs: 0,
            lastStatus: null,
          };
          const count = existing.count + 1;
          const totalMs = existing.totalMs + durationMs;
          return {
            ...prev,
            [requestKey]: {
              count,
              totalMs,
              avgMs: totalMs / count,
              lastMs: durationMs,
              lastStatus: status,
            },
          };
        });
        if (!FAST_POLL_KEYS.has(requestKey)) return;
        setPerfSeries((prev) => {
          const list = prev[requestKey] ? [...prev[requestKey]] : [];
          list.push({ ts: Date.now(), ms: durationMs });
          return {
            ...prev,
            [requestKey]: list.slice(-MAX_PERF_POINTS),
          };
        });
      };
      const parseRetryDelayMs = (response) => {
        const raw = response.headers?.get?.("retry-after");
        if (raw) {
          const seconds = Number(raw);
          if (Number.isFinite(seconds) && seconds >= 0) {
            return Math.max(500, Math.round(seconds * 1000));
          }
          const retryDate = Date.parse(raw);
          if (Number.isFinite(retryDate)) {
            return Math.max(500, retryDate - Date.now());
          }
        }
        return FAST_POLL_KEYS.has(requestKey) ? 1200 : 2500;
      };
      try {
        const res = await fetch(url, { ...options, headers });
        const text = await res.text();
        const data = safeJson(text);
        const durationMs = Math.max(0, performance.now() - startedAt);
        recordMetric(res.status, durationMs);
        log(
          `${method} ${path} -> ${res.status} (${Math.round(durationMs)}ms)`,
          "request"
        );
        if (res.status === 429) {
          const retryDelayMs = parseRetryDelayMs(res);
          endpointRateLimitUntilRef.current.set(requestKey, Date.now() + retryDelayMs);
        } else if (res.ok) {
          endpointRateLimitUntilRef.current.delete(requestKey);
        }
        if (!res.ok) {
          const error = new Error(`HTTP ${res.status}`);
          error.status = res.status;
          error.data = data;
          error.__logged = true;
          throw error;
        }
        return data;
      } catch (error) {
        if (error?.__logged) {
          throw error;
        }
        if (error?.__silent) {
          throw error;
        }
        const durationMs = Math.max(0, performance.now() - startedAt);
        const status = error?.status ?? "ERR";
        recordMetric(status, durationMs);
        log(`${method} ${path} -> ${status} (${Math.round(durationMs)}ms)`, "request");
        const networkError = error instanceof TypeError && String(error.message).includes("fetch");
        if (networkError) {
          const wrapped = new Error("Network error (possible CORS block)");
          wrapped.isNetworkError = true;
          throw wrapped;
        }
        throw error;
      }
    },
    [log]
  );

  const apiGet = useCallback(
    async (path, params = {}) => requestWithConfig(config, path, params),
    [config, requestWithConfig]
  );

  const apiPost = useCallback(
    async (path, params = {}) =>
      requestWithConfig(config, path, params, { method: "POST" }),
    [config, requestWithConfig]
  );

  const apiDelete = useCallback(
    async (path) => requestWithConfig(config, path, null, { method: "DELETE" }),
    [config, requestWithConfig]
  );

  const maybeSuggestProxy = useCallback(
    (error) => {
      if (!error?.isNetworkError) return;
      if (mode === "local" && useProxyLocal) return;
      if (mode === "remote" && useProxyRemote) return;
      setProxyHint("Browser blocked this request (likely CORS). Run the local proxy and enable Use Proxy.");
    },
    [mode, useProxyLocal, useProxyRemote]
  );

  const connect = useCallback(async () => {
    setConnectionError("");
    setProxyHint("");
    setConnectionStatus("Connecting...");
    endpointRateLimitUntilRef.current = new Map();
    const useProxy = mode === "local" ? useProxyLocal : useProxyRemote;
    const localProxyBase = localProxyUrl.trim() || "http://localhost:3001";
    const remoteProxyBase =
      proxyTargetRemote === "remote" && cloudProxyUrl.trim()
        ? cloudProxyUrl.trim()
        : localProxyBase;
    const remoteAuthHeader =
      remoteConfig.authMode === "header"
        ? remoteConfig.authHeader
        : encodeBasic(remoteConfig.username, remoteConfig.password);
    const resolvedRemoteBase = remoteConfig.baseUrl;
    const proxyParams = (() => {
      if (!(useProxy && proxyTargetRemote === "remote")) return {};
      try {
        const parsed = new URL(resolvedRemoteBase);
        return {
          host: parsed.hostname || undefined,
          port: parsed.port || undefined,
        };
      } catch {
        return {};
      }
    })();
    const cfg =
      mode === "local"
        ? {
            baseUrl: useProxy ? localProxyBase : localConfig.baseUrl,
            headers: {
              "X-API-Key": localConfig.apiKey,
              ...(useProxy ? { "X-Proxy-Target": "local" } : {}),
            },
          }
        : {
            baseUrl: useProxy ? remoteProxyBase : resolvedRemoteBase,
            headers: {
              Authorization: remoteAuthHeader,
              ...(useProxy
                ? {
                    "X-Proxy-Target": "remote",
                    "X-Proxy-Base": resolvedRemoteBase,
                  }
                : {}),
            },
            params: proxyParams,
          };
    try {
      const caseData = await requestWithConfig(cfg, "/case");
      setActiveConfig(cfg);
      setCaseInfo(caseData);
      setConnectionStatus("Connected");
      setLastConnectAt(Date.now());
      setLastBookUpdateAt(0);
      playSound("connect");
      log(`Connected to ${cfg.baseUrl}`, "system");
      log(`Case: ${caseData?.name ?? "Unknown"}`, "system");
    } catch (error) {
      setActiveConfig(null);
      setConnectionStatus("Disconnected");
      const errMessage = error?.data?.message || error?.message || "Connection failed";
      setConnectionError(errMessage);
      if (error?.isNetworkError && !useProxy) {
        setProxyHint("Browser blocked this request (likely CORS). Run the local proxy and enable Use Proxy.");
      }
      log(`Connection error: ${error?.message || "Unknown"}`, "error");
    }
  }, [
    cloudProxyUrl,
    localConfig,
    mode,
    playSound,
    proxyTargetRemote,
    remoteConfig,
    requestWithConfig,
    log,
    localProxyUrl,
    useProxyLocal,
    useProxyRemote,
  ]);

  const disconnect = () => {
    setActiveConfig(null);
    setConnectionStatus("Disconnected");
    setCaseInfo(null);
    setSecurities([]);
    setSelectedTicker("");
    setBookPanels([{ id: BOOK_PANEL_PRIMARY_ID, ticker: "" }]);
    setBooksByTicker({});
    setHistory([]);
    setBookHistoryByTicker({});
    setMnaHistoryByTicker({});
    setOrders([]);
    setBookExtraRows({});
    bookExtraRowsRef.current = {};
    setRealizedSeries([]);
    setUnrealizedSeries([]);
    setFills([]);
    setTasTrades([]);
    tasAfterRef.current = null;
    pnlUpdateRef.current = { tick: null, realized: null, unrealized: null };
    orderTypeByIdRef.current = new Map();
    pendingPlacementsRef.current = [];
    seenFillIdsRef.current = new Set();
    filledOrderIdsRef.current = new Set();
    setLastConnectAt(0);
    setLastBookUpdateAt(0);
    lastCaseRef.current = { tick: null, period: null };
    bookCenterRef.current = { connectAt: null, caseKey: null, tick1Period: null, idleAt: null };
    bookAnchorRef.current = { connectAt: null, caseKey: null, tick1Period: null, idleAt: null };
    setBookAnchors({});
    endpointRateLimitUntilRef.current = new Map();
    log("Disconnected", "system");
  };

  // High-frequency polling lane for market state + trader state.
  useEffect(() => {
    if (!config) return undefined;
    let stop = false;

    const pull = async () => {
      try {
        const data = await apiGet("/case");
        if (!stop) setCaseInfo(data || null);
      } catch (error) {
        if (!stop && error?.status !== 429) {
          log(`Case error: ${error.message}`, "error");
          maybeSuggestProxy(error);
        }
      }
    };

    pull();
    const id = setInterval(pull, POLL_INTERVALS_MS.case);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [apiGet, config, log, maybeSuggestProxy]);

  useEffect(() => {
    if (!config || !selectedTicker) return undefined;
    let stop = false;
    const tasPollMs = orderbookDisplayMode === "graph" ? 700 : POLL_INTERVALS_MS.tas;

    const pull = async () => {
      try {
        const params = { ticker: selectedTicker, limit: 200 };
        if (tasAfterRef.current != null) {
          params.after = tasAfterRef.current;
        }
        const data = await apiGet("/securities/tas", params);
        if (stop) return;
        const list = Array.isArray(data) ? data : [];
        if (!list.length) return;
        const normalized = list
          .map((item) => ({
            id: item.id ?? item.trade_id ?? item.tas_id,
            tick: item.tick ?? null,
            price: item.price ?? null,
            quantity: item.quantity ?? item.qty ?? item.size ?? null,
          }))
          .filter(
            (item) =>
              item.id != null &&
              Number.isFinite(Number(item.tick)) &&
              Number.isFinite(Number(item.price))
          );
        if (!normalized.length) return;
        setTasTrades((prev) => {
          const map = new Map(prev.map((entry) => [entry.id, entry]));
          normalized.forEach((entry) => map.set(entry.id, entry));
          const merged = Array.from(map.values());
          merged.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
          return merged.slice(-400);
        });
        const maxId = Math.max(...normalized.map((entry) => Number(entry.id) || -1));
        if (Number.isFinite(maxId) && maxId >= 0) {
          tasAfterRef.current = maxId;
        }
      } catch (error) {
        if (!stop && error?.status !== 429) {
          log(`TAS error: ${error.message}`, "error");
          maybeSuggestProxy(error);
        }
      }
    };

    pull();
    const id = setInterval(pull, tasPollMs);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [apiGet, config, log, maybeSuggestProxy, orderbookDisplayMode, selectedTicker]);

  useEffect(() => {
    if (!config) return undefined;
    let stop = false;
    const fillsPollMs = orderbookDisplayMode === "graph" ? 700 : POLL_INTERVALS_MS.fills;

    const pull = async () => {
      try {
        const data = await apiGet("/orders", { status: "TRANSACTED" });
        if (stop) return;
        const list = Array.isArray(data) ? data : [];
        if (!list.length) return;
        setFills((prev) => {
          const map = new Map(prev.map((entry) => [entry.order_id ?? entry.id, entry]));
          list.forEach((entry) => {
            const id = entry.order_id ?? entry.id;
            if (id == null) return;
            map.set(id, entry);
          });
          const merged = Array.from(map.values());
          merged.sort((a, b) => {
            const tickA = Number(a.tick ?? 0);
            const tickB = Number(b.tick ?? 0);
            if (tickA !== tickB) return tickA - tickB;
            return Number(a.order_id ?? 0) - Number(b.order_id ?? 0);
          });
          return merged.slice(-600);
        });
      } catch (error) {
        if (!stop && error?.status !== 429) {
          log(`Fills error: ${error.message}`, "error");
          maybeSuggestProxy(error);
        }
      }
    };

    pull();
    const id = setInterval(pull, fillsPollMs);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [apiGet, config, log, maybeSuggestProxy, orderbookDisplayMode]);

  useEffect(() => {
    if (!fills.length) return;
    const seen = seenFillIdsRef.current;
    // First load: mark fills as seen so we don't play the welcome symphony.
    if (seen.size === 0) {
      fills.forEach((fill) => {
        const fillKey =
          fill.order_id ??
          fill.id ??
          `${fill.ticker}-${fill.tick}-${fill.vwap ?? fill.price}-${fill.action}`;
        seen.add(String(fillKey));
      });
      return;
    }
    const now = Date.now();
    const freshFills = [];
    fills.forEach((fill) => {
      const fillKey =
        fill.order_id ??
        fill.id ??
        `${fill.ticker}-${fill.tick}-${fill.vwap ?? fill.price}-${fill.action}`;
      const key = String(fillKey);
      if (seen.has(key)) return;
      seen.add(key);
      freshFills.push(fill);
    });
    if (!freshFills.length) return;
    pendingPlacementsRef.current = pendingPlacementsRef.current.filter(
      (entry) => now - entry.placedAt < 15000
    );
    freshFills.forEach((fill) => {
      const orderId = fill.order_id ?? fill.id ?? null;
      if (orderId != null && filledOrderIdsRef.current.has(orderId)) {
        orderTypeByIdRef.current.delete(orderId);
        return;
      }
      let kind = null;
      const rawType = String(fill.order_type ?? fill.type ?? "").toUpperCase();
      if (rawType === "MARKET") kind = "market";
      if (rawType === "LIMIT") kind = "limit";
      if (!kind && orderId != null) {
        kind = orderTypeByIdRef.current.get(orderId) || null;
      }
      if (!kind) {
        const qty = Number(fill.quantity_filled ?? fill.quantity ?? fill.qty ?? 0);
        const matchIndex = pendingPlacementsRef.current.findIndex((entry) => {
          if (entry.ticker !== fill.ticker) return false;
          if (entry.side !== fill.action) return false;
          if (Number.isFinite(qty) && Number(entry.qty) !== qty) return false;
          return now - entry.placedAt < 10000;
        });
        if (matchIndex >= 0) {
          kind = pendingPlacementsRef.current[matchIndex].kind;
          pendingPlacementsRef.current.splice(matchIndex, 1);
        }
      }
      if (kind === "market") {
        playSound("marketFilled");
      } else if (kind === "limit") {
        playSound("limitFilled");
      }
      if (orderId != null) {
        orderTypeByIdRef.current.delete(orderId);
        filledOrderIdsRef.current.add(orderId);
      }
    });
  }, [fills, playSound]);

  useEffect(() => {
    tasAfterRef.current = null;
    setTasTrades([]);
  }, [selectedTicker]);

  useEffect(() => {
    if (connectionStatus !== "Connected") return;
    if (!fills.length) return;
    const priceMap = new Map();
    securities.forEach((sec) => {
      const last = Number(sec.last);
      const bid = Number(sec.bid);
      const ask = Number(sec.ask);
      const mid =
        Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : Number.NaN;
      const price = Number.isFinite(last) ? last : Number.isFinite(mid) ? mid : bid || ask;
      if (Number.isFinite(price)) {
        priceMap.set(sec.ticker, price);
      }
    });
    const positions = new Map();
    let realized = 0;
    const sorted = [...fills].sort((a, b) => {
      const tickA = Number(a.tick ?? 0);
      const tickB = Number(b.tick ?? 0);
      if (tickA !== tickB) return tickA - tickB;
      return Number(a.order_id ?? 0) - Number(b.order_id ?? 0);
    });
    sorted.forEach((fill) => {
      const price = Number(fill.vwap ?? fill.price);
      const qty = Number(fill.quantity_filled ?? fill.quantity ?? fill.qty ?? 0);
      if (!Number.isFinite(price) || !Number.isFinite(qty) || qty === 0) return;
      const signed = fill.action === "BUY" ? qty : -qty;
      const ticker = fill.ticker;
      const current = positions.get(ticker) || { qty: 0, avg: 0 };
      const sameSide = current.qty === 0 || Math.sign(current.qty) === Math.sign(signed);
      if (sameSide) {
        const newQty = current.qty + signed;
        const totalCost =
          Math.abs(current.qty) * current.avg + Math.abs(signed) * price;
        const avg = newQty === 0 ? 0 : totalCost / Math.abs(newQty);
        positions.set(ticker, { qty: newQty, avg });
        return;
      }
      const closing = Math.min(Math.abs(current.qty), Math.abs(signed));
      if (current.qty > 0) {
        realized += (price - current.avg) * closing;
      } else {
        realized += (current.avg - price) * closing;
      }
      const remaining = Math.abs(signed) - closing;
      const newQty = current.qty + signed;
      if (remaining > 0) {
        positions.set(ticker, { qty: newQty, avg: price });
      } else {
        positions.set(ticker, { qty: newQty, avg: newQty === 0 ? 0 : current.avg });
      }
    });
    let unrealized = 0;
    positions.forEach((pos, ticker) => {
      if (!pos.qty) return;
      const price = priceMap.get(ticker);
      if (!Number.isFinite(price)) return;
      if (pos.qty > 0) {
        unrealized += (price - pos.avg) * pos.qty;
      } else {
        unrealized += (pos.avg - price) * Math.abs(pos.qty);
      }
    });
    const stamp = Date.now();
    const currentTick = Number(caseInfo?.tick);
    const roundedRealized = Number(realized.toFixed(2));
    const roundedUnrealized = Number(unrealized.toFixed(2));
    const lastSnapshot = pnlUpdateRef.current;
    const realizedChanged =
      !Number.isFinite(lastSnapshot.realized) || roundedRealized !== lastSnapshot.realized;
    const unrealizedChanged =
      !Number.isFinite(lastSnapshot.unrealized) || roundedUnrealized !== lastSnapshot.unrealized;
    const tickKnown = Number.isFinite(currentTick);
    const tickDelta =
      tickKnown && Number.isFinite(lastSnapshot.tick) ? currentTick - lastSnapshot.tick : 0;
    const shouldStep =
      tickKnown && (!Number.isFinite(lastSnapshot.tick) || tickDelta >= PNL_TICK_STEP);
    if (!realizedChanged && !unrealizedChanged && !shouldStep) return;
    pnlUpdateRef.current = {
      tick: tickKnown ? currentTick : lastSnapshot.tick,
      realized: roundedRealized,
      unrealized: roundedUnrealized,
    };
    setRealizedSeries((prev) => [...prev, { ts: stamp, value: roundedRealized }].slice(-600));
    setUnrealizedSeries((prev) => [...prev, { ts: stamp, value: roundedUnrealized }].slice(-600));
  }, [caseInfo?.tick, connectionStatus, fills, securities]);

  useEffect(() => {
    if (connectionStatus !== "Connected" || !caseInfo) return;
    const ticksPerPeriod = Number(caseInfo.ticks_per_period);
    const tick = Number(caseInfo.tick);
    const period = caseInfo.period ?? null;
    if (!Number.isFinite(ticksPerPeriod) || !Number.isFinite(tick) || ticksPerPeriod <= 0) return;
    const ticksLeft = Math.max(ticksPerPeriod - tick, 0);
    if (tickAlertRef.current.period !== period) {
      tickAlertRef.current.period = period;
      tickAlertRef.current.fired = new Set();
    }
    const thresholds = [100, 50, 10];
    if (thresholds.includes(ticksLeft) && !tickAlertRef.current.fired.has(ticksLeft)) {
      tickAlertRef.current.fired.add(ticksLeft);
      // One alert per threshold per period — no time-traveling back to spam it. 🕰️
      notify(`Tick alert: ${ticksLeft} ticks left in period ${period}.`, "warning", "alert");
    }
    const finalCountdown = [3, 2, 1];
    if (finalCountdown.includes(ticksLeft) && !tickAlertRef.current.fired.has(ticksLeft)) {
      tickAlertRef.current.fired.add(ticksLeft);
      const sound = ticksLeft === 3 ? "tickShort" : ticksLeft === 2 ? "tickMid" : "tickLong";
      playSound(sound);
    }
  }, [caseInfo, connectionStatus, notify, playSound]);

  useEffect(() => {
    if (!demoStrategy.enabled || !config || !selectedTicker) return undefined;
    let stop = false;

    const run = async () => {
      if (stop || caseInfo?.status === "STOPPED") return;
      const snap = marketSnapRef.current;
      if (!Number.isFinite(snap.mid) || snap.mid === 0) return;
      const side = snap.last > snap.mid ? "SELL" : "BUY";
      if (side === "BUY" && snap.position >= demoStrategy.maxPos) return;
      if (side === "SELL" && snap.position <= -demoStrategy.maxPos) return;
      try {
        await apiPost("/orders", {
          ticker: selectedTicker,
          type: "MARKET",
          quantity: demoStrategy.quantity,
          action: side,
        });
        log(`Demo strategy: ${side} ${demoStrategy.quantity} ${selectedTicker} @ MKT`, "strategy");
      } catch (error) {
        log(`Demo strategy error: ${error?.data?.message || error.message}`, "error");
      }
    };

    run();
    const id = setInterval(run, demoStrategy.intervalMs);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [
    apiPost,
    caseInfo?.status,
    config,
    demoStrategy.enabled,
    demoStrategy.intervalMs,
    demoStrategy.maxPos,
    demoStrategy.quantity,
    log,
    selectedTicker,
  ]);

  useEffect(() => {
    if (!caseInfo) return;
    const currTick = Number(caseInfo.tick);
    const currPeriod = caseInfo.period ?? null;
    const prev = lastCaseRef.current;
    const hasPrev = prev.tick !== null && prev.tick !== undefined;
    const tickReset = hasPrev && Number.isFinite(currTick) && currTick === 1;
    if (tickReset) {
      setHistory([]);
      setChartView({});
      setRealizedSeries([]);
      setUnrealizedSeries([]);
      setFills([]);
      setTasTrades([]);
      setBookExtraRows({});
      bookExtraRowsRef.current = {};
      pnlUpdateRef.current = { tick: null, realized: null, unrealized: null };
      tasAfterRef.current = null;
      // Fresh period, fresh candles — like a reset button, but friendlier. ✨
      setHistoryEpoch((value) => value + 1);
    }
    lastCaseRef.current = {
      tick: Number.isFinite(currTick) ? currTick : null,
      period: currPeriod,
    };
  }, [caseInfo]);

  useEffect(() => {
    if (!config) return undefined;
    let stop = false;
    const securitiesPollMs =
      orderbookDisplayMode === "graph" ? 650 : POLL_INTERVALS_MS.securities;

    const pull = async () => {
      try {
        const list = await apiGet("/securities");
        if (!stop) setSecurities(list || []);
      } catch (error) {
        if (!stop) {
          log(`Securities error: ${error.message}`, "error");
          maybeSuggestProxy(error);
        }
      }
    };

    pull();
    const id = setInterval(pull, securitiesPollMs);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [apiGet, config, log, maybeSuggestProxy, orderbookDisplayMode]);

  useEffect(() => {
    if (!config) return undefined;
    let stop = false;
    const tendersPollMs = orderbookDisplayMode === "graph" ? 1200 : POLL_INTERVALS_MS.tenders;

    const pull = async () => {
      try {
        const list = await apiGet("/tenders");
        if (stop) return;
        const next = Array.isArray(list) ? list : [];
        setTenders(next);
        const nextIds = new Set(next.map((item) => item.tender_id));
        next.forEach((item) => {
          if (!tenderIdsRef.current.has(item.tender_id)) {
            playSound("tender");
          }
        });
        tenderIdsRef.current = nextIds;
      } catch (error) {
        if (!stop && error?.status !== 429) {
          log(`Tenders error: ${error.message}`, "error");
        }
      }
    };

    pull();
    const id = setInterval(pull, tendersPollMs);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [apiGet, config, log, orderbookDisplayMode, playSound]);

  useEffect(() => {
    if (!tenders.length) return;
    setTenderPrices((prev) => {
      const next = { ...prev };
      tenders.forEach((tender) => {
        if (!tender.is_fixed_bid && next[tender.tender_id] === undefined) {
          if (tender.price != null) {
            next[tender.tender_id] = tender.price;
          }
        }
      });
      return next;
    });
  }, [tenders]);

  useEffect(() => {
    if (securities.length && !selectedTicker) {
      setSelectedTicker(securities[0]?.ticker || "");
    }
  }, [securities, selectedTicker]);

  useEffect(() => {
    if (!selectedTicker) return;
    setOrderDraft((prev) => ({ ...prev, ticker: selectedTicker }));
  }, [selectedTicker]);

  useEffect(() => {
    if (!selectedTicker) return;
    setBookPanels((prev) => {
      const hasPrimary = prev.some((panel) => panel.id === BOOK_PANEL_PRIMARY_ID);
      const nextPanels = hasPrimary ? [...prev] : [{ id: BOOK_PANEL_PRIMARY_ID, ticker: selectedTicker }, ...prev];
      let changed = !hasPrimary;
      const updated = nextPanels.map((panel) => {
        if (panel.id !== BOOK_PANEL_PRIMARY_ID) return panel;
        if (panel.ticker === selectedTicker) return panel;
        changed = true;
        return { ...panel, ticker: selectedTicker };
      });
      return changed ? updated : prev;
    });
  }, [selectedTicker]);

  const bookTickers = useMemo(() => {
    const tickers = bookPanels.map((panel) => panel.ticker).filter(Boolean);
    if (!tickers.length && selectedTicker) tickers.push(selectedTicker);
    return Array.from(new Set(tickers));
  }, [bookPanels, selectedTicker]);

  useEffect(() => {
    if (!config || !bookTickers.length || orderbookDisplayMode !== "book") return undefined;
    let stop = false;
    let inFlight = false;
    let timeoutId = null;
    let cursor = 0;
    let delayMs =
      bookTickers.length > 1
        ? Math.max(BOOK_POLL_BACKOFF_MS, POLL_INTERVALS_MS.book || 0)
        : POLL_INTERVALS_MS.book;

    const pullBook = async () => {
      if (stop || inFlight) return;
      inFlight = true;
      const ticker = bookTickers[cursor % bookTickers.length];
      cursor += 1;
      try {
        const bookData = await apiGet("/securities/book", {
          ticker,
          limit: BOOK_DEPTH_LIMIT,
        });
        if (!stop) {
          setBooksByTicker((prev) => ({ ...prev, [ticker]: bookData || null }));
          if (ticker === selectedTicker) {
            setLastBookUpdateAt(Date.now());
            if (hadStaleRef.current) {
              setChartView({});
              hadStaleRef.current = false;
            }
          }
        }
        delayMs =
          bookTickers.length > 1
            ? Math.max(BOOK_POLL_BACKOFF_MS, POLL_INTERVALS_MS.book || 0)
            : POLL_INTERVALS_MS.book;
      } catch (error) {
        if (!stop && error?.status !== 429) {
          log(`Book error: ${error.message}`, "error");
          maybeSuggestProxy(error);
        }
        if (error?.status === 429) {
          delayMs = Math.min(
            BOOK_POLL_MAX_MS,
            Math.max(BOOK_POLL_BACKOFF_MS, delayMs * 2 || BOOK_POLL_BACKOFF_MS)
          );
        } else {
          delayMs = Math.min(
            BOOK_POLL_MAX_MS,
            Math.max(BOOK_POLL_BACKOFF_MS, delayMs || BOOK_POLL_BACKOFF_MS)
          );
        }
      } finally {
        inFlight = false;
        if (!stop) {
          // No overlapping book pulls — keep the tape moving, not the hamster wheel.
          // If we hit 429s, give the API a breather (even machines need coffee).
          timeoutId = setTimeout(pullBook, delayMs);
        }
      }
    };

    pullBook();
    return () => {
      stop = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [apiGet, bookTickers, config, log, maybeSuggestProxy, orderbookDisplayMode, selectedTicker]);

  useEffect(() => {
    if (!config) return undefined;
    let stop = false;
    let inFlight = false;
    let timeoutId = null;
    const ordersPollMs = orderbookDisplayMode === "graph" ? 700 : POLL_INTERVALS_MS.orders;

    const pullOrders = async () => {
      if (stop || inFlight) return;
      inFlight = true;
      try {
        const orderData = await apiGet("/orders", { status: "OPEN" });
        if (!stop) {
          const nextOrders = (orderData || []).map((order) => {
            const orderId = order?.order_id ?? order?.id;
            const localBracket = bracketByOrderIdRef.current.get(orderId) || null;
            const stopLoss = firstFinite(getOrderStopLoss(order), localBracket?.stopLoss);
            const takeProfit = firstFinite(getOrderTakeProfit(order), localBracket?.takeProfit);
            if (orderId != null && (stopLoss != null || takeProfit != null)) {
              bracketByOrderIdRef.current.set(orderId, {
                stopLoss: stopLoss ?? null,
                takeProfit: takeProfit ?? null,
              });
            }
            if (stopLoss == null && takeProfit == null) return order;
            return {
              ...order,
              ...(stopLoss != null ? { stop_loss: stopLoss } : {}),
              ...(takeProfit != null ? { take_profit: takeProfit } : {}),
            };
          });
          const prevOrders = openOrdersRef.current || [];
          const prevMap = new Map(
            prevOrders.map((order) => [order.order_id ?? order.id, order])
          );
          const nextMap = new Map(
            nextOrders.map((order) => [order.order_id ?? order.id, order])
          );
          prevMap.forEach((order, orderId) => {
            if (!nextMap.has(orderId)) {
              const cancelledAt = cancelledOrdersRef.current.get(orderId);
              if (!cancelledAt || Date.now() - cancelledAt > 8000) {
                if (!filledOrderIdsRef.current.has(orderId)) {
                  const kind = orderTypeByIdRef.current.get(orderId) || "limit";
                  playSound(kind === "market" ? "marketFilled" : "limitFilled");
                  filledOrderIdsRef.current.add(orderId);
                }
              }
              cancelledOrdersRef.current.delete(orderId);
              orderTypeByIdRef.current.delete(orderId);
              bracketByOrderIdRef.current.delete(orderId);
              pendingPlacementsRef.current = pendingPlacementsRef.current.filter(
                (entry) => entry.orderId !== orderId
              );
            }
          });
          openOrdersRef.current = nextOrders;
          setOrders(nextOrders);
        }
      } catch (error) {
        if (!stop && error?.status !== 429) {
          log(`Orders error: ${error.message}`, "error");
          maybeSuggestProxy(error);
        }
      } finally {
        inFlight = false;
        if (!stop) {
          timeoutId = setTimeout(pullOrders, ordersPollMs);
        }
      }
    };

    pullOrders();
    return () => {
      stop = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [apiGet, config, log, maybeSuggestProxy, orderbookDisplayMode, playSound]);

  useEffect(() => {
    if (!config) return undefined;
    let stop = false;

    const pull = async () => {
      try {
        const params = { limit: 20 };
        if (newsSinceRef.current !== null && newsSinceRef.current !== undefined) {
          params.since = newsSinceRef.current;
        }
        const data = await apiGet("/news", params);
        const list = Array.isArray(data) ? data : data?.news || [];
        if (!Array.isArray(list) || list.length === 0) return;
        const normalized = list.map((item) => {
          const sortKey = Number(
            item.news_id ??
              item.id ??
              item.tick ??
              item.timestamp ??
              item.time ??
              item.ts ??
              0
          );
          const text =
            item.headline ??
            item.title ??
            item.body ??
            item.text ??
            item.news ??
            item.message ??
            JSON.stringify(item);
          return {
            id: Number.isFinite(sortKey) && sortKey !== 0 ? sortKey : `${Date.now()}-${Math.random()}`,
            sortKey,
            text,
            receivedAt: Date.now(),
          };
        });
        const clearedAfter = clearNewsSortKeyRef.current;
        const filtered = Number.isFinite(clearedAfter)
          ? normalized.filter((entry) => (entry.sortKey ?? -1) > clearedAfter)
          : normalized;
        if (!stop && filtered.length) {
          let didPing = false;
          setNewsItems((prev) => {
            const map = new Map(prev.map((entry) => [entry.id, entry]));
            filtered.forEach((entry) => {
              if (!map.has(entry.id)) {
                didPing = true;
                map.set(entry.id, entry);
                return;
              }
              const existing = map.get(entry.id);
              map.set(entry.id, {
                ...entry,
                receivedAt: existing?.receivedAt ?? entry.receivedAt,
              });
            });
            const merged = Array.from(map.values());
            merged.sort((a, b) => (a.sortKey || 0) - (b.sortKey || 0));
            const cutoff = Date.now() - NEWS_TTL_MS;
            return merged.filter((item) => (item.receivedAt ?? 0) >= cutoff).slice(-60);
          });
          if (didPing) {
            playSound("news");
          }
          const maxKey = Math.max(
            ...filtered.map((entry) => (Number.isFinite(entry.sortKey) ? entry.sortKey : -1))
          );
          if (Number.isFinite(maxKey) && maxKey >= 0) {
            newsSinceRef.current = maxKey;
          }
        }
      } catch (error) {
        if (!stop && error?.status !== 429) {
          log(`News error: ${error.message}`, "news");
        }
      }
    };

    pull();
    const id = setInterval(pull, POLL_INTERVALS_MS.news);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [apiGet, config, log, playSound]);

  useEffect(() => {
    const id = setInterval(() => {
      setNewsItems((prev) =>
        prev.filter((item) => Date.now() - (item.receivedAt ?? 0) < NEWS_TTL_MS)
      );
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!dismissedNewsIds.length) return;
    const activeIds = new Set(newsItems.map((item) => item.id));
    setDismissedNewsIds((prev) => {
      const filtered = prev.filter((id) => activeIds.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [dismissedNewsIds.length, newsItems]);

  useEffect(() => {
    if (!config || !selectedTicker || caseInfo?.tick == null || isMergerArbCase) return;
    let stop = false;
    const pull = async () => {
      try {
        const periodLimit = Number(caseInfo?.ticks_per_period) || 300;
        const limit = Math.max(120, periodLimit);
        const historyData = await apiGet("/securities/history", {
          ticker: selectedTicker,
          limit,
        });
        if (!stop) setHistory(historyData || []);
      } catch (error) {
        if (!stop && error?.status !== 429) {
          log(`History error: ${error.message}`, "error");
          maybeSuggestProxy(error);
        }
      }
    };
    pull();
    return () => {
      stop = true;
    };
  }, [
    apiGet,
    caseInfo?.tick,
    caseInfo?.ticks_per_period,
    config,
    historyEpoch,
    isMergerArbCase,
    log,
    maybeSuggestProxy,
    selectedTicker,
  ]);

  useEffect(() => {
    if (isMergerArbCase || !selectedTicker) return;
    if (!Array.isArray(history) || !history.length) return;
    setBookHistoryByTicker((prev) => ({
      ...prev,
      [selectedTicker]: history,
    }));
  }, [history, isMergerArbCase, selectedTicker]);

  useEffect(() => {
    if (!config || isMergerArbCase || orderbookDisplayMode !== "book" || bookPanels.length <= 1) {
      return;
    }
    const tickers = Array.from(new Set(bookPanels.map((panel) => panel.ticker).filter(Boolean)));
    if (!tickers.length) return;
    let stop = false;
    let timeoutId = null;
    let cursor = 0;
    let delayMs = Math.max(1200, tickers.length * 380);

    const pull = async () => {
      if (stop) return;
      const periodLimit = Number(caseInfo?.ticks_per_period) || 300;
      const limit = Math.max(120, periodLimit);
      const ticker = tickers[cursor % tickers.length];
      cursor += 1;
      try {
        const rows = await apiGet("/securities/history", { ticker, limit });
        if (!stop && Array.isArray(rows)) {
          setBookHistoryByTicker((prev) => ({
            ...prev,
            [ticker]: rows,
          }));
        }
        delayMs = Math.max(1200, tickers.length * 380);
      } catch (error) {
        if (!stop && error?.status !== 429) {
          log(`Book chart history error (${ticker}): ${error.message}`, "error");
          maybeSuggestProxy(error);
        }
        if (error?.status === 429) {
          delayMs = Math.min(6000, Math.round(delayMs * 1.5));
        }
      } finally {
        if (!stop) timeoutId = setTimeout(pull, delayMs);
      }
    };

    pull();
    return () => {
      stop = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [
    apiGet,
    bookPanels,
    caseInfo?.ticks_per_period,
    config,
    historyEpoch,
    isMergerArbCase,
    log,
    maybeSuggestProxy,
    orderbookDisplayMode,
  ]);

  useEffect(() => {
    if (!isMergerArbCase || !config) return;
    const tickers = Array.from(
      new Set(
        activeMnaPairs.flatMap((pair) => [pair.targetTicker, pair.acquirerTicker]).filter(Boolean)
      )
    );
    if (!tickers.length) return;
    let stop = false;
    let timeoutId = null;
    let cursor = 0;
    let delayMs = Math.max(1200, tickers.length * 450);

    const pull = async () => {
      if (stop) return;
      const periodLimit = Number(caseInfo?.ticks_per_period) || 300;
      const limit = Math.max(120, periodLimit);
      const ticker = tickers[cursor % tickers.length];
      cursor += 1;
      try {
        const rows = await apiGet("/securities/history", { ticker, limit });
        if (!stop && Array.isArray(rows)) {
          setMnaHistoryByTicker((prev) => ({
            ...prev,
            [ticker]: rows,
          }));
        }
        delayMs = Math.max(1200, tickers.length * 450);
      } catch (error) {
        if (!stop && error?.status !== 429) {
          log(`Pair history error (${ticker}): ${error.message}`, "error");
          maybeSuggestProxy(error);
        }
        if (error?.status === 429) {
          delayMs = Math.min(6000, Math.round(delayMs * 1.5));
        }
      } finally {
        if (!stop) {
          timeoutId = setTimeout(pull, delayMs);
        }
      }
    };

    pull();
    return () => {
      stop = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [
    activeMnaPairs,
    apiGet,
    caseInfo?.ticks_per_period,
    config,
    historyEpoch,
    isMergerArbCase,
    log,
    maybeSuggestProxy,
  ]);

  useEffect(() => {
    if (isMergerArbCase) return;
    setMnaHistoryByTicker({});
  }, [isMergerArbCase]);

  useEffect(() => {
    if (isMergerArbCase) return;
    if (bookPanels.length > 1) return;
    setBookHistoryByTicker({});
  }, [bookPanels.length, isMergerArbCase]);

  const handleCancel = async (orderId) => {
    if (!config) return;
    try {
      cancelledOrdersRef.current.set(orderId, Date.now());
      await apiDelete(`/orders/${orderId}`);
      log(`Order ${orderId} cancelled.`, "order");
    } catch (error) {
      log(`Cancel error: ${error?.data?.message || error.message}`, "error");
    }
  };

  const bulkCancelOrders = useCallback(async () => {
    if (!config) return;
    try {
      await apiPost("/commands/cancel", { all: 1 });
      log("Bulk cancel sent.", "order");
      notify("Bulk cancel sent.", "warning");
    } catch (error) {
      log(`Bulk cancel error: ${error?.data?.message || error.message}`, "error");
    }
  }, [apiPost, config, log, notify]);

  // Mouse/quick order path used by both orderbook rows and chart trading.
  const placeQuickOrder = async (ticker, side, price, isMarket = false, source = "book") => {
    if (!config || !ticker) return;
    const quantity = Math.max(1, parseInt(orderDraft.quantity, 10) || 1);
    const decimals = decimalsByTicker.get(ticker) ?? 2;
    const roundPrice = (value) => Number(Number(value).toFixed(decimals));
    const roundedPrice = roundPrice(price);
    const security = securityByTicker.get(ticker) || {};
    const bid = Number(security.bid);
    const ask = Number(security.ask);
    const last = Number(security.last);
    const currentPrice =
      Number.isFinite(bid) && Number.isFinite(ask)
        ? (bid + ask) / 2
        : Number.isFinite(last)
          ? last
          : Number.isFinite(bid)
            ? bid
            : Number.isFinite(ask)
              ? ask
              : null;
    const slPercent = Number(bracketDefaults.stopLossOffset);
    const tpPercent = Number(bracketDefaults.takeProfitOffset);
    try {
      const payload = {
        ticker,
        type: isMarket ? "MARKET" : "LIMIT",
        quantity,
        action: side,
        ...(isMarket ? {} : { price: roundedPrice }),
      };
      const referencePrice = Number.isFinite(currentPrice)
        ? (isMarket ? currentPrice : roundedPrice)
        : roundedPrice;
      const hasDefaultBracket =
        bracketDefaults.enabled &&
        Number.isFinite(referencePrice) &&
        Number.isFinite(slPercent) &&
        Number.isFinite(tpPercent) &&
        slPercent > 0 &&
        tpPercent > 0;
      if (hasDefaultBracket) {
        const slFactor = slPercent / 100;
        const tpFactor = tpPercent / 100;
        const stopLoss =
          side === "BUY"
            ? referencePrice * (1 - slFactor)
            : referencePrice * (1 + slFactor);
        const takeProfit =
          side === "BUY"
            ? referencePrice * (1 + tpFactor)
            : referencePrice * (1 - tpFactor);
        payload.stop_loss = roundPrice(stopLoss);
        payload.take_profit = roundPrice(takeProfit);
      }
      const response = await apiPost("/orders", payload);
      const orderId = response?.order_id ?? response?.id ?? null;
      const kind = isMarket ? "market" : "limit";
      if (orderId != null) {
        orderTypeByIdRef.current.set(orderId, kind);
        if (payload.stop_loss != null || payload.take_profit != null) {
          bracketByOrderIdRef.current.set(orderId, {
            stopLoss: payload.stop_loss ?? null,
            takeProfit: payload.take_profit ?? null,
          });
        }
      }
      pendingPlacementsRef.current = [
        {
          orderId,
          kind,
          ticker,
          side,
          qty: quantity,
          stopLoss: payload.stop_loss ?? null,
          takeProfit: payload.take_profit ?? null,
          placedAt: Date.now(),
        },
        ...pendingPlacementsRef.current,
      ].slice(0, 40);
      const priceLabel = isMarket ? "MKT" : roundedPrice;
      const bracketLabel =
        payload.stop_loss != null || payload.take_profit != null
          ? ` (SL ${payload.stop_loss ?? "—"} / TP ${payload.take_profit ?? "—"})`
          : "";
      log(`Quick order (${source}): ${side} ${quantity} ${ticker} @ ${priceLabel}${bracketLabel}`, "order");
      playSound(kind === "market" ? "marketPlaced" : "limitPlaced");
    } catch (error) {
      log(`Quick order error: ${error?.data?.message || error.message}`, "error");
    }
  };

  const acceptTender = async (tender) => {
    if (!config) return;
    try {
      const fallback = tender.price != null ? Number(tender.price) : null;
      const priceValue = tenderPrices[tender.tender_id] ?? fallback;
      if (!tender.is_fixed_bid && !priceValue) {
        notify("Enter a tender price before accepting.", "info");
        return;
      }
      const payload = priceValue ? { price: Number(priceValue) } : {};
      await apiPost(`/tenders/${tender.tender_id}`, payload);
      notify(`Tender accepted: ${tender.ticker} ${tender.quantity}`, "success");
      setTenders((prev) => prev.filter((item) => item.tender_id !== tender.tender_id));
    } catch (error) {
      log(`Tender accept error: ${error?.data?.message || error.message}`, "error");
    }
  };

  const declineTender = async (tenderId) => {
    if (!config) return;
    try {
      await apiDelete(`/tenders/${tenderId}`);
      notify(`Tender declined: ${tenderId}`, "info");
      setTenders((prev) => prev.filter((item) => item.tender_id !== tenderId));
    } catch (error) {
      log(`Tender decline error: ${error?.data?.message || error.message}`, "error");
    }
  };

  const securityByTicker = useMemo(
    () => new Map(securities.map((sec) => [sec.ticker, sec])),
    [securities]
  );

  const decimalsByTicker = useMemo(() => {
    const map = new Map();
    securities.forEach((sec) => {
      const decimals = Number.isInteger(sec.quoted_decimals) ? sec.quoted_decimals : 2;
      if (sec.ticker) map.set(sec.ticker, decimals);
    });
    return map;
  }, [securities]);

  const aggregateLevels = useCallback((levels, decimals) => {
    const map = new Map();
    (levels || []).forEach((level) => {
      if (level?.price === undefined || level?.price === null) return;
      const qty = getQty(level) ?? 0;
      const key = Number(level.price).toFixed(decimals);
      map.set(key, (map.get(key) || 0) + qty);
    });
    return map;
  }, []);

  const positionMap = useMemo(() => buildPositionsFromFills(fills), [fills]);

  const isCaseStopped =
    connectionStatus === "Connected" && caseInfo?.status === "STOPPED";

  const hasActivePositionForTicker = useCallback(
    (ticker) => {
      if (!ticker || isCaseStopped) return false;
      const fromFills = Number(positionMap.get(ticker)?.qty);
      const sec = securityByTicker.get(ticker) || {};
      const fallback = Number(sec.position ?? sec.pos ?? sec.qty ?? 0);
      const qty = Number.isFinite(fromFills) ? fromFills : fallback;
      return Number.isFinite(qty) && qty !== 0;
    },
    [isCaseStopped, positionMap, securityByTicker]
  );

  const ordersByTickerPrice = useMemo(() => {
    const map = new Map();
    orders.forEach((order) => {
      const ticker = order?.ticker;
      if (!ticker || order?.price == null) return;
      const includeRiskLevels = hasActivePositionForTicker(ticker);
      const decimals = decimalsByTicker.get(ticker) ?? 2;
      const key = Number(order.price).toFixed(decimals);
      const side = String(order.action || "").toUpperCase();
      const qty = Number(order.quantity ?? order.qty ?? 0);
      const tickerMap = map.get(ticker) || new Map();
      const entry =
        tickerMap.get(key) || {
          buyQty: 0,
          buyCount: 0,
          sellQty: 0,
          sellCount: 0,
          buyStops: new Set(),
          buyTargets: new Set(),
          sellStops: new Set(),
          sellTargets: new Set(),
        };
      const stopLoss = getOrderStopLoss(order);
      const takeProfit = getOrderTakeProfit(order);
      if (side === "BUY") {
        entry.buyQty += qty;
        entry.buyCount += 1;
        if (includeRiskLevels && stopLoss != null) {
          entry.buyStops.add(Number(stopLoss).toFixed(decimals));
        }
        if (includeRiskLevels && takeProfit != null) {
          entry.buyTargets.add(Number(takeProfit).toFixed(decimals));
        }
      } else if (side === "SELL") {
        entry.sellQty += qty;
        entry.sellCount += 1;
        if (includeRiskLevels && stopLoss != null) {
          entry.sellStops.add(Number(stopLoss).toFixed(decimals));
        }
        if (includeRiskLevels && takeProfit != null) {
          entry.sellTargets.add(Number(takeProfit).toFixed(decimals));
        }
      }
      tickerMap.set(key, entry);
      map.set(ticker, tickerMap);
    });
    return map;
  }, [decimalsByTicker, hasActivePositionForTicker, orders]);

  const riskLevelsByTicker = useMemo(() => {
    const map = new Map();
    orders.forEach((order) => {
      const ticker = order?.ticker;
      if (!ticker) return;
      if (!hasActivePositionForTicker(ticker)) return;
      const decimals = decimalsByTicker.get(ticker) ?? 2;
      const entry = map.get(ticker) || { stopLoss: new Set(), takeProfit: new Set() };
      const stopLoss = getOrderStopLoss(order);
      const takeProfit = getOrderTakeProfit(order);
      if (stopLoss != null) entry.stopLoss.add(Number(stopLoss).toFixed(decimals));
      if (takeProfit != null) entry.takeProfit.add(Number(takeProfit).toFixed(decimals));
      map.set(ticker, entry);
    });
    return map;
  }, [decimalsByTicker, hasActivePositionForTicker, orders]);

  const baseRowCount = 80;

  useEffect(() => {
    if (!bookTickers.length) return;
    const baseHalfRows = Math.floor(baseRowCount / 2);
    const prevExtras = bookExtraRowsRef.current || {};
    let nextExtras = { ...prevExtras };
    let changed = false;
    let scrollDelta = 0;

    bookTickers.forEach((ticker) => {
      const quotedDecimals = decimalsByTicker.get(ticker) ?? 2;
      const priceStep = getStepFromDecimals(quotedDecimals);
      const bookData = booksByTicker[ticker] || null;
      const bidLevels = bookData?.bids || bookData?.bid || [];
      const askLevels = bookData?.asks || bookData?.ask || [];
      const prices = [];
      bidLevels.forEach((level) => {
        const value = Number(level?.price);
        if (Number.isFinite(value)) prices.push(value);
      });
      askLevels.forEach((level) => {
        const value = Number(level?.price);
        if (Number.isFinite(value)) prices.push(value);
      });
      const orderPrices = ordersByTickerPrice.get(ticker);
      if (orderPrices) {
        orderPrices.forEach((_, key) => {
          const value = Number(key);
          if (Number.isFinite(value)) prices.push(value);
        });
      }
      const riskLevels = riskLevelsByTicker.get(ticker);
      if (riskLevels) {
        riskLevels.stopLoss.forEach((key) => {
          const value = Number(key);
          if (Number.isFinite(value)) prices.push(value);
        });
        riskLevels.takeProfit.forEach((key) => {
          const value = Number(key);
          if (Number.isFinite(value)) prices.push(value);
        });
      }
      if (!prices.length) return;
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);

      const sec = securityByTicker.get(ticker) || {};
      const last = Number(sec.last);
      const bid = Number(sec.bid);
      const ask = Number(sec.ask);
      const bestBid = bidLevels[0]?.price ?? bid ?? last;
      const bestAsk = askLevels[0]?.price ?? ask ?? last;
      const bestBidNumber = Number(bestBid);
      const bestAskNumber = Number(bestAsk);
      const fallbackPrice = Number.isFinite(last)
        ? last
        : Number.isFinite(bestBidNumber)
          ? bestBidNumber
          : bestAskNumber;
      const midPrice =
        Number.isFinite(bestBidNumber) && Number.isFinite(bestAskNumber)
          ? (bestBidNumber + bestAskNumber) / 2
          : fallbackPrice;
      const anchorPrice = Number.isFinite(bookAnchors[ticker]) ? bookAnchors[ticker] : midPrice;
      if (!Number.isFinite(anchorPrice)) return;
      const anchorTick = toStepTick(anchorPrice, priceStep);
      const minTick = toStepTick(minPrice, priceStep);
      const maxTick = toStepTick(maxPrice, priceStep);
      const maxDistance = Math.max(
        Math.abs(anchorTick - minTick),
        Math.abs(maxTick - anchorTick)
      );
      const requiredHalfRows = Math.max(baseHalfRows, maxDistance + BOOK_EDGE_BUFFER_TICKS);
      const requiredExtra = Math.max(0, requiredHalfRows - baseHalfRows);
      const prevExtra = prevExtras[ticker] || 0;
      if (requiredExtra > prevExtra) {
        nextExtras[ticker] = requiredExtra;
        changed = true;
        if (ticker === selectedTicker) {
          scrollDelta = Math.max(scrollDelta, requiredExtra - prevExtra);
        }
      }
    });

    if (!changed) return;
    if (scrollDelta && bookScrollRef.current) {
      bookScrollRef.current.scrollTop += scrollDelta * BOOK_ROW_HEIGHT_PX;
    }
    bookExtraRowsRef.current = nextExtras;
    setBookExtraRows(nextExtras);
  }, [
    baseRowCount,
    bookAnchors,
    bookTickers,
    booksByTicker,
    decimalsByTicker,
    ordersByTickerPrice,
    riskLevelsByTicker,
    securityByTicker,
    selectedTicker,
  ]);

  // Build dense row state once per ticker so the UI layer can stay mostly declarative.
  const buildBookState = useCallback(
    (ticker) => {
      if (!ticker) {
        return {
          ticker,
          quotedDecimals: 2,
          priceStep: getStepFromDecimals(2),
          rows: [],
          maxVolume: 1,
          bestBidPrice: null,
          bestAskPrice: null,
          midPrice: 0,
          ordersByPrice: new Map(),
        };
      }
      const security = securityByTicker.get(ticker) || {};
      const quotedDecimals = decimalsByTicker.get(ticker) ?? 2;
      const priceStep = getStepFromDecimals(quotedDecimals);
      const bookData = booksByTicker[ticker] || null;
      const bidLevels = bookData?.bids || bookData?.bid || [];
      const askLevels = bookData?.asks || bookData?.ask || [];
      const bidMap = aggregateLevels(bidLevels, quotedDecimals);
      const askMap = aggregateLevels(askLevels, quotedDecimals);
      const maxVolume = Math.max(
        1,
        ...Array.from(bidMap.values()),
        ...Array.from(askMap.values())
      );
      const last = security.last ?? null;
      const bid = security.bid ?? null;
      const ask = security.ask ?? null;
      const bestBidPrice = bidLevels[0]?.price ?? bid ?? last;
      const bestAskPrice = askLevels[0]?.price ?? ask ?? last;
      const bestBidNumber = Number(bestBidPrice);
      const bestAskNumber = Number(bestAskPrice);
      const fallbackPrice = Number.isFinite(Number(last))
        ? Number(last)
        : Number.isFinite(bestBidNumber)
          ? bestBidNumber
          : Number.isFinite(bestAskNumber)
            ? bestAskNumber
            : Number.NaN;
      const midPrice =
        Number.isFinite(bestBidNumber) && Number.isFinite(bestAskNumber)
          ? (bestBidNumber + bestAskNumber) / 2
          : fallbackPrice;
      const anchorPrice = Number.isFinite(bookAnchors[ticker]) ? bookAnchors[ticker] : midPrice;
      const anchorTick = toStepTick(Number.isFinite(anchorPrice) ? anchorPrice : 0, priceStep);
      const baseHalfRows = Math.floor(baseRowCount / 2);
      const extraHalfRows = bookExtraRows[ticker] || 0;
      const halfRows = baseHalfRows + extraHalfRows;
      const rowCount = Math.max(2, halfRows * 2);
      const liveMidTick = Number.isFinite(midPrice) ? toStepTick(midPrice, priceStep) : anchorTick;
      const hasSpread =
        Number.isFinite(bestBidNumber) &&
        Number.isFinite(bestAskNumber) &&
        bestAskNumber - bestBidNumber > priceStep;
      const spreadCenterTick = hasSpread
        ? toStepTick((bestBidNumber + bestAskNumber) / 2, priceStep)
        : liveMidTick;
      const position = isCaseStopped ? null : positionMap.get(ticker) || null;
      const fallbackQty = Number(security.position ?? security.pos ?? security.qty ?? 0);
      const fallbackAvg = Number(security.avg ?? security.vwap ?? security.price ?? NaN);
      const positionQty = Number(position?.qty ?? fallbackQty);
      const entryPrice = Number(position?.avg ?? fallbackAvg);
      const hasPosition =
        Number.isFinite(entryPrice) &&
        Number.isFinite(positionQty) &&
        positionQty !== 0 &&
        Number.isFinite(midPrice);
      const pnlValue = hasPosition
        ? positionQty > 0
          ? (midPrice - entryPrice) * positionQty
          : (entryPrice - midPrice) * Math.abs(positionQty)
        : null;
      const positionRange = hasPosition
        ? {
            min: Math.min(entryPrice, midPrice),
            max: Math.max(entryPrice, midPrice),
            tone: pnlValue >= 0 ? "win" : "loss",
            side: positionQty > 0 ? "long" : "short",
            entryPrice,
            direction: positionQty > 0 ? "up" : "down",
            entryTone: pnlValue >= 0 ? "positive" : "negative",
          }
        : null;
      const entryKey =
        positionRange?.entryPrice != null
          ? Number(positionRange.entryPrice).toFixed(quotedDecimals)
          : null;
      const riskLevels = riskLevelsByTicker.get(ticker) || {
        stopLoss: new Set(),
        takeProfit: new Set(),
      };
      const rows = Array.from({ length: rowCount }, (_, idx) => {
        const offset = halfRows - idx;
        const tick = anchorTick + offset;
        const price = fromStepTick(tick, priceStep, quotedDecimals);
        const key = price.toFixed(quotedDecimals);
        const isSpread =
          hasSpread && price > bestBidNumber && price < bestAskNumber;
        const inPnlRange =
          positionRange && price >= positionRange.min && price <= positionRange.max;
        return {
          price,
          bidQty: bidMap.get(key) || 0,
          askQty: askMap.get(key) || 0,
          isMid: hasSpread && tick === liveMidTick,
          isSpread,
          isCenter: tick === spreadCenterTick,
          pnlTone: inPnlRange ? positionRange.tone : null,
          pnlSide: inPnlRange ? positionRange.side : null,
          isEntry: entryKey ? key === entryKey : false,
          entryDirection: positionRange?.direction || null,
          entryTone: positionRange?.entryTone || null,
          hasStopLoss: riskLevels.stopLoss.has(key),
          hasTakeProfit: riskLevels.takeProfit.has(key),
          key,
        };
      });
      return {
        ticker,
        quotedDecimals,
        priceStep,
        rows,
        maxVolume,
        bestBidPrice,
        bestAskPrice,
        midPrice,
        ordersByPrice: ordersByTickerPrice.get(ticker) || new Map(),
      };
    },
    [
      aggregateLevels,
      baseRowCount,
      bookAnchors,
      bookExtraRows,
      booksByTicker,
      decimalsByTicker,
      isCaseStopped,
      ordersByTickerPrice,
      positionMap,
      riskLevelsByTicker,
      securityByTicker,
    ]
  );

  const selectedBookState = useMemo(
    () => buildBookState(selectedTicker),
    [buildBookState, selectedTicker]
  );
  const bookStates = useMemo(
    () => bookPanels.map((panel) => ({ panel, state: buildBookState(panel.ticker) })),
    [bookPanels, buildBookState]
  );
  const bookStateByTicker = useMemo(() => {
    const map = new Map();
    bookStates.forEach(({ panel, state }) => {
      if (!panel.ticker || map.has(panel.ticker)) return;
      map.set(panel.ticker, state);
    });
    return map;
  }, [bookStates]);
  const primaryBookState = useMemo(
    () =>
      bookStates.find(({ panel }) => panel.id === BOOK_PANEL_PRIMARY_ID)?.state || null,
    [bookStates]
  );
  const isMultiBook = bookPanels.length > 1;

  const lastPrice = securityByTicker.get(selectedTicker)?.last ?? null;
  const bidPrice = securityByTicker.get(selectedTicker)?.bid ?? null;
  const askPrice = securityByTicker.get(selectedTicker)?.ask ?? null;
  const priceRows = primaryBookState?.rows || [];
  const bestBidPrice = selectedBookState.bestBidPrice ?? bidPrice ?? lastPrice;
  const bestAskPrice = selectedBookState.bestAskPrice ?? askPrice ?? lastPrice;
  const midPrice = selectedBookState.midPrice;

  useEffect(() => {
    const sec = securities.find((item) => item.ticker === selectedTicker) || {};
    marketSnapRef.current = {
      last: Number(sec.last ?? lastPrice ?? 0),
      mid: Number(midPrice ?? 0),
      position: Number(sec.position ?? sec.pos ?? sec.qty ?? 0),
      bestBid: Number(bestBidPrice ?? 0),
      bestAsk: Number(bestAskPrice ?? 0),
    };
  }, [securities, selectedTicker, lastPrice, midPrice, bestBidPrice, bestAskPrice]);

  useEffect(() => {
    if (connectionStatus !== "Connected") return;
    const caseKey = caseInfo?.name ?? caseInfo?.case_id ?? caseInfo?.case ?? null;
    const anchorState = bookAnchorRef.current;
    let shouldReset = false;

    if (lastConnectAt && anchorState.connectAt !== lastConnectAt) {
      anchorState.connectAt = lastConnectAt;
      shouldReset = true;
    }

    if (caseKey && anchorState.caseKey !== caseKey) {
      anchorState.caseKey = caseKey;
      shouldReset = true;
    }

    if (!shouldReset) return;

    setBookAnchors(() => {
      const next = {};
      bookTickers.forEach((ticker) => {
        const state = bookStateByTicker.get(ticker);
        const liveMid = state?.midPrice;
        if (Number.isFinite(liveMid)) {
          next[ticker] = liveMid;
        }
      });
      return next;
    });
  }, [
    bookStateByTicker,
    bookTickers,
    caseInfo?.case,
    caseInfo?.case_id,
    caseInfo?.name,
    connectionStatus,
    lastConnectAt,
  ]);

  useEffect(() => {
    if (connectionStatus !== "Connected" || !bookTickers.length) return;
    setBookAnchors((prev) => {
      let changed = false;
      const next = { ...prev };
      bookTickers.forEach((ticker) => {
        if (next[ticker] != null) return;
        const state = bookStateByTicker.get(ticker);
        const liveMid = state?.midPrice;
        if (!Number.isFinite(liveMid)) return;
        next[ticker] = liveMid;
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [bookStateByTicker, bookTickers, connectionStatus]);

  const centerOrderBook = useCallback((panelId = null) => {
    const centerContainer = (container) => {
      if (!container) return false;
      const target = container.querySelector('[data-center="true"]');
      if (!target) return false;
      const targetTop = target.offsetTop;
      const targetHeight = target.offsetHeight || 0;
      const containerHeight = container.clientHeight || 0;
      const nextScrollTop = Math.max(0, targetTop - containerHeight / 2 + targetHeight / 2);
      container.scrollTo({ top: nextScrollTop, behavior: "auto" });
      return true;
    };

    if (panelId) {
      return centerContainer(bookScrollRefs.current[panelId] || null);
    }

    const containers = Object.values(bookScrollRefs.current || {});
    if (!containers.length) return false;
    let centered = false;
    containers.forEach((container) => {
      centered = centerContainer(container) || centered;
    });
    return centered;
  }, []);

  useEffect(() => {
    if (!AUTO_CENTER_BOOK_ON_CONNECT) return;
    if (connectionStatus !== "Connected") return;
    const caseKey = caseInfo?.name ?? caseInfo?.case_id ?? caseInfo?.case ?? null;
    const bookCenterState = bookCenterRef.current;

    if (lastConnectAt && bookCenterState.connectAt !== lastConnectAt) {
      if (!centerOrderBook()) return;
      bookCenterState.connectAt = lastConnectAt;
      if (caseKey) bookCenterState.caseKey = caseKey;
      return;
    }

    if (caseKey && bookCenterState.caseKey !== caseKey) {
      if (!centerOrderBook()) return;
      bookCenterState.caseKey = caseKey;
      return;
    }
  }, [
    caseInfo?.case,
    caseInfo?.case_id,
    caseInfo?.name,
    centerOrderBook,
    connectionStatus,
    lastConnectAt,
    priceRows.length,
  ]);

  useEffect(() => {
    if (!AUTO_CENTER_BOOK_ON_CONNECT) return;
    if (connectionStatus !== "Connected") return;
    if (orderbookDisplayMode !== "book") return;
    const tick = Number(caseInfo?.tick);
    if (!Number.isFinite(tick) || tick !== 1) return;
    const caseKey = caseInfo?.name ?? caseInfo?.case_id ?? caseInfo?.case ?? null;
    const period = caseInfo?.period ?? null;
    const tickKey = `${caseKey ?? "case"}:${period ?? "p0"}`;
    const bookCenterState = bookCenterRef.current;
    if (bookCenterState.tick1Period === tickKey) return;
    if (!centerOrderBook()) return;
    // Tick-1 auto-center: because the new period deserves a clean slate.
    bookCenterState.tick1Period = tickKey;
  }, [
    caseInfo?.case,
    caseInfo?.case_id,
    caseInfo?.name,
    caseInfo?.period,
    caseInfo?.tick,
    centerOrderBook,
    connectionStatus,
    orderbookDisplayMode,
  ]);

  // Order book scroll stays where the trader puts it. Autoscroll was cute, not useful.

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.isComposing) return;
      const target = event.target;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) {
        return;
      }
      // Hotkeys: because mice deserve coffee breaks too. ☕️
      if (event.code === "Space") {
        event.preventDefault();
        bulkCancelOrders();
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "b") {
        setBookView("book");
        return;
      }
      if (key === "l") {
        setBookView("ladder");
        return;
      }
      if (key === "c" || key === "r") {
        centerOrderBook();
        return;
      }
      if (key === "a") {
        addBookPanel();
        return;
      }
      if (event.key === "Escape") {
        setShowTerminalPrompt(false);
        setShowUpdatePrompt(false);
        setShowShortcuts(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    addBookPanel,
    bulkCancelOrders,
    centerOrderBook,
    setBookView,
    setShowTerminalPrompt,
    setShowUpdatePrompt,
    setShowShortcuts,
  ]);

  // Chart model build stage: candles, fills, order levels, and indicator overlays.
  const candles = useMemo(() => aggregateCandles(history, 5), [history]);

  const indicatorData = useMemo(() => {
    if (!candles.length) return null;
    const ticks = candles.map((c) => c.tick);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const sma20 = calcSMA(closes, 20);
    const sma50 = calcSMA(closes, 50);
    const sma100 = calcSMA(closes, 100);
    const sma200 = calcSMA(closes, 200);
    const ema9 = calcEMA(closes, 9);
    const ema21 = calcEMA(closes, 21);
    const ema50 = calcEMA(closes, 50);
    const wma20 = calcWMA(closes, 20);
    const dema20 = calcDEMA(closes, 20);
    const std20 = calcStdDev(closes, 20);
    const bollinger = {
      upper: sma20.map((value, index) => {
        const dev = std20[index];
        if (!Number.isFinite(value) || !Number.isFinite(dev)) return null;
        return Number((value + 2 * dev).toFixed(4));
      }),
      middle: sma20,
      lower: sma20.map((value, index) => {
        const dev = std20[index];
        if (!Number.isFinite(value) || !Number.isFinite(dev)) return null;
        return Number((value - 2 * dev).toFixed(4));
      }),
    };
    const keltner = calcKeltner(highs, lows, closes, 20, 1.5);
    const donchian = calcDonchian(highs, lows, 20);
    const rsi14 = calcRSI(closes, 14);
    const macd = calcMACD(closes, 12, 26, 9);
    const stochastic = calcStochastic(highs, lows, closes, 14, 3);
    const atr14 = calcATR(highs, lows, closes, 14);
    const adx14 = calcADX(highs, lows, closes, 14);
    const cci20 = calcCCI(highs, lows, closes, 20);
    const roc12 = calcROC(closes, 12);
    const williams14 = calcWilliamsR(highs, lows, closes, 14);
    return {
      ticks,
      sma20,
      sma50,
      sma100,
      sma200,
      ema9,
      ema21,
      ema50,
      wma20,
      dema20,
      bollinger,
      keltner,
      donchian,
      rsi14,
      macd,
      stochastic,
      atr14,
      adx14,
      cci20,
      roc12,
      williams14,
    };
  }, [candles]);

  const dealPoints = useMemo(
    () =>
      tasTrades
        .map((trade) => ({
          tick: toBucketTick(Number(trade.tick)),
          price: Number(trade.price),
        }))
        .filter((trade) => Number.isFinite(trade.tick) && Number.isFinite(trade.price)),
    [tasTrades]
  );

  const fillMarkers = useMemo(() => {
    return buildFillMarkersForTicker(fills, selectedTicker);
  }, [fills, selectedTicker]);

  const openFillPoints = useMemo(
    () =>
      fillMarkers.opens
        .map((fill) => ({
          tick: toBucketTick(Number(fill.tick)),
          price: Number(fill.vwap ?? fill.price),
          side: fill.action === "BUY" ? "BUY" : "SELL",
        }))
        .filter((fill) => Number.isFinite(fill.tick) && Number.isFinite(fill.price)),
    [fillMarkers.opens]
  );

  const closeFillPoints = useMemo(
    () =>
      fillMarkers.closes
        .map((fill) => ({
          tick: toBucketTick(Number(fill.tick)),
          price: Number(fill.vwap ?? fill.price),
          side: fill.action === "BUY" ? "BUY" : "SELL",
        }))
        .filter((fill) => Number.isFinite(fill.tick) && Number.isFinite(fill.price)),
    [fillMarkers.closes]
  );

  const orderLevels = useMemo(() => {
    const decimals = decimalsByTicker.get(selectedTicker) ?? 2;
    return buildOrderLevelsForTicker({
      orders,
      ticker: selectedTicker,
      decimals,
      includeRiskLevels: hasActivePositionForTicker(selectedTicker),
    });
  }, [decimalsByTicker, hasActivePositionForTicker, orders, selectedTicker]);

  const getTickerLivePrice = useCallback(
    (ticker) => {
      if (!ticker) return null;
      const sec = securityByTicker.get(ticker) || {};
      const bid = firstFinite(sec.bid);
      const ask = firstFinite(sec.ask);
      const last = firstFinite(sec.last);
      const mid =
        bid != null && ask != null
          ? (bid + ask) / 2
          : firstFinite(last, bid, ask);
      return firstFinite(mid, last, bid, ask);
    },
    [securityByTicker]
  );

  const selectedMnaReferenceLevels = useMemo(() => {
    if (!isMergerArbCase || !selectedTicker) return [];
    const pair = activeMnaPairs.find(
      (item) => item.targetTicker === selectedTicker || item.acquirerTicker === selectedTicker
    );
    if (!pair) return [];

    const acquirerAnchor = firstFinite(
      getTickerLivePrice(pair.acquirerTicker),
      getMnaStartingPrice(pair, pair.acquirerTicker)
    );
    const targetPrice = deriveMnaTargetPrice(pair, acquirerAnchor);
    const startingPrice = getMnaStartingPrice(pair, selectedTicker);
    return [
      ...(Number.isFinite(targetPrice)
        ? [
            {
              price: targetPrice,
              label: `${pair.targetTicker} deal value`,
              color: "rgba(124, 58, 237, 0.92)",
              style: "dash",
            },
          ]
        : []),
      ...(Number.isFinite(startingPrice)
        ? [
            {
              price: startingPrice,
              label: `${selectedTicker} start`,
              color: "rgba(14, 116, 144, 0.92)",
              style: "dot",
            },
          ]
        : []),
    ];
  }, [activeMnaPairs, getTickerLivePrice, isMergerArbCase, selectedTicker]);

  const indicatorTraces = useMemo(() => {
    if (!indicatorData) return [];
    const traces = [];
    const axis = "y2";
    const addLine = (name, values, color, targetAxis = "y") => {
      traces.push({
        type: "scatter",
        mode: "lines",
        name,
        x: indicatorData.ticks,
        y: values,
        line: { color, width: 1.6 },
        yaxis: targetAxis,
      });
    };
    if (indicatorState.sma20) addLine("SMA 20", indicatorData.sma20, "#1f77b4");
    if (indicatorState.sma50) addLine("SMA 50", indicatorData.sma50, "#9467bd");
    if (indicatorState.sma100) addLine("SMA 100", indicatorData.sma100, "#0ea5e9");
    if (indicatorState.sma200) addLine("SMA 200", indicatorData.sma200, "#6366f1");
    if (indicatorState.ema9) addLine("EMA 9", indicatorData.ema9, "#22c55e");
    if (indicatorState.ema21) addLine("EMA 21", indicatorData.ema21, "#16a34a");
    if (indicatorState.ema50) addLine("EMA 50", indicatorData.ema50, "#15803d");
    if (indicatorState.wma20) addLine("WMA 20", indicatorData.wma20, "#f59e0b");
    if (indicatorState.dema20) addLine("DEMA 20", indicatorData.dema20, "#f97316");
    if (indicatorState.bollinger) {
      addLine("Bollinger Upper", indicatorData.bollinger.upper, "#94a3b8");
      addLine("Bollinger Mid", indicatorData.bollinger.middle, "#64748b");
      addLine("Bollinger Lower", indicatorData.bollinger.lower, "#94a3b8");
    }
    if (indicatorState.keltner) {
      addLine("Keltner Upper", indicatorData.keltner.upper, "#22d3ee");
      addLine("Keltner Mid", indicatorData.keltner.middle, "#0ea5e9");
      addLine("Keltner Lower", indicatorData.keltner.lower, "#22d3ee");
    }
    if (indicatorState.donchian) {
      addLine("Donchian Upper", indicatorData.donchian.upper, "#f472b6");
      addLine("Donchian Lower", indicatorData.donchian.lower, "#f472b6");
    }
    if (indicatorState.rsi14) addLine("RSI 14", indicatorData.rsi14, "#a855f7", axis);
    if (indicatorState.macd) {
      addLine("MACD", indicatorData.macd.macd, "#f97316", axis);
      addLine("MACD Signal", indicatorData.macd.signal, "#fb7185", axis);
    }
    if (indicatorState.stochastic) {
      addLine("Stochastic %K", indicatorData.stochastic.k, "#38bdf8", axis);
      addLine("Stochastic %D", indicatorData.stochastic.d, "#0ea5e9", axis);
    }
    if (indicatorState.atr14) addLine("ATR 14", indicatorData.atr14, "#facc15", axis);
    if (indicatorState.adx14) addLine("ADX 14", indicatorData.adx14, "#ef4444", axis);
    if (indicatorState.cci20) addLine("CCI 20", indicatorData.cci20, "#14b8a6", axis);
    if (indicatorState.roc12) addLine("ROC 12", indicatorData.roc12, "#22c55e", axis);
    if (indicatorState.williams14)
      addLine("Williams %R", indicatorData.williams14, "#f472b6", axis);
    return traces;
  }, [indicatorData, indicatorState]);

  const showOscillatorAxis = useMemo(
    () => OSCILLATOR_INDICATORS.some((id) => indicatorState[id]),
    [indicatorState]
  );
  const chartRendererMeta = useMemo(
    () => getCandleRendererMeta(chartRenderer),
    [chartRenderer]
  );

  const chartGridColor =
    theme === "dark" ? "rgba(148, 163, 184, 0.22)" : "rgba(15, 23, 42, 0.12)";
  const chartTextColor = theme === "dark" ? "#e2e8f0" : "#0f172a";
  const chartPlotBg = theme === "dark" ? "#000000" : "#ffffff";

  const chartConfig = {
    displayModeBar: true,
    responsive: true,
    scrollZoom: true,
    doubleClick: "reset",
    modeBarButtonsToRemove: ["select2d", "lasso2d"],
  };

  const handlePlotlyRelayout = useCallback((ev) => {
    if (ev["xaxis.autorange"] || ev["yaxis.autorange"]) {
      setChartView({});
      return;
    }
    setChartView((prev) => {
      const next = {};
      if (ev["xaxis.range[0]"] && ev["xaxis.range[1]"]) {
        next.xaxis = {
          ...(prev.xaxis || {}),
          range: [ev["xaxis.range[0]"], ev["xaxis.range[1]"]],
        };
      }
      if (ev["yaxis.range[0]"] && ev["yaxis.range[1]"]) {
        next.yaxis = {
          ...(prev.yaxis || {}),
          range: [ev["yaxis.range[0]"], ev["yaxis.range[1]"]],
        };
      }
      if (!Object.keys(next).length) return prev;
      return {
        ...prev,
        ...next,
      };
    });
  }, []);

  const updatePlotlyScaleLock = useCallback(
    (scaleKey, ev) => {
      if (autoScaleCharts || !scaleKey || !ev) return;
      if (ev["yaxis.autorange"]) {
        plotlyYRangeLocksRef.current.delete(scaleKey);
        return;
      }
      const directRange = Array.isArray(ev["yaxis.range"]) ? ev["yaxis.range"] : null;
      const y0 = Number(directRange?.[0] ?? ev["yaxis.range[0]"]);
      const y1 = Number(directRange?.[1] ?? ev["yaxis.range[1]"]);
      if (!Number.isFinite(y0) || !Number.isFinite(y1)) return;
      const min = Math.min(y0, y1);
      const max = Math.max(y0, y1);
      if (max - min <= 0) return;
      plotlyYRangeLocksRef.current.set(scaleKey, [min, max]);
    },
    [autoScaleCharts]
  );

  useEffect(() => {
    if (autoScaleCharts) {
      plotlyYRangeLocksRef.current.clear();
      setChartView({});
    }
  }, [autoScaleCharts]);

  const handleChartTradeIntentForTicker = async (ticker, button, clickedPrice) => {
    if (!config || !ticker || !Number.isFinite(clickedPrice)) return;
    if (!chartMouseTrading) {
      const nowMs = Date.now();
      if (nowMs - chartTradingHintAtRef.current > 2000) {
        chartTradingHintAtRef.current = nowMs;
        notify("Enable chart mouse trading in Chart Settings first.", "info");
      }
      return;
    }
    const decimals = decimalsByTicker.get(ticker) ?? 2;
    const normalizedPrice = Number(Number(clickedPrice).toFixed(decimals));
    const security = securityByTicker.get(ticker) || {};
    const bidValue = firstFinite(security.bid);
    const askValue = firstFinite(security.ask);
    const liveMid = firstFinite(
      bidValue != null && askValue != null
        ? (bidValue + askValue) / 2
        : null,
      security.mid,
      security.last,
      bidValue,
      askValue
    );
    if (liveMid == null) {
      notify("Cannot trade from chart yet, waiting for live price.", "info");
      return;
    }
    const action = button === "right" ? "SELL" : "BUY";
    const isMarket =
      action === "BUY" ? normalizedPrice > liveMid : normalizedPrice < liveMid;
    await placeQuickOrder(ticker, action, normalizedPrice, isMarket, "chart");
  };

  const buildHorizontalTraces = useCallback((xStart, xEnd, referenceLevels) => {
    return referenceLevels
      .filter((level) => Number.isFinite(Number(level.price)))
      .map((level) => ({
        type: "scatter",
        mode: "lines",
        name: level.label || "Reference",
        x: [xStart, xEnd],
        y: [level.price, level.price],
        line: {
          color: level.color || "rgba(71, 85, 105, 0.9)",
          width: level.width ?? 1.1,
          dash: level.style === "dot" ? "dot" : level.style === "dash" ? "dash" : "solid",
        },
      }));
  }, []);

  const computeYRange = useCallback((candlesInput = [], levelGroups = [], pointGroups = []) => {
    const prices = [
      ...candlesInput.flatMap((candle) => [candle.low, candle.high, candle.open, candle.close]),
      ...levelGroups.flatMap((levels) => levels.map((level) => level.price)),
      ...pointGroups.flatMap((points) => points.map((point) => point.price)),
    ]
      .map((value) => Number(value))
      .filter(Number.isFinite);
    if (!prices.length) return null;
    const minValue = Math.min(...prices);
    const maxValue = Math.max(...prices);
    const spread = maxValue - minValue;
    const padding = spread > 0 ? spread * 0.08 : Math.max(Math.abs(maxValue) * 0.02, 1);
    return [minValue - padding, maxValue + padding];
  }, []);

  const resolvePlotlyYAxisConfig = useCallback(
    (scaleKey, candlesInput = [], levelGroups = [], pointGroups = []) => {
      if (autoScaleCharts) {
        plotlyYRangeLocksRef.current.delete(scaleKey);
        return { autorange: true };
      }
      const lockedRange = plotlyYRangeLocksRef.current.get(scaleKey);
      if (lockedRange) {
        return { autorange: false, range: lockedRange };
      }
      const nextRange = computeYRange(candlesInput, levelGroups, pointGroups);
      if (!nextRange) return { autorange: false };
      plotlyYRangeLocksRef.current.set(scaleKey, nextRange);
      return { autorange: false, range: nextRange };
    },
    [autoScaleCharts, computeYRange]
  );

  const mnaChartModelsByTicker = useMemo(() => {
    if (!isMergerArbCase) return new Map();
    const tickers = Array.from(
      new Set(
        activeMnaPairs.flatMap((pair) => [pair.targetTicker, pair.acquirerTicker]).filter(Boolean)
      )
    );
    const next = new Map();
    tickers.forEach((ticker) => {
      const rows = mnaHistoryByTicker[ticker] || (ticker === selectedTicker ? history : []);
      const tickerCandles = aggregateCandles(rows, CANDLE_BUCKET);
      const markerSet = buildFillMarkersForTicker(fills, ticker);
      const openPoints = markerSet.opens
        .map((fill) => ({
          tick: toBucketTick(Number(fill.tick)),
          price: Number(fill.vwap ?? fill.price),
          side: fill.action === "BUY" ? "BUY" : "SELL",
        }))
        .filter((fill) => Number.isFinite(fill.tick) && Number.isFinite(fill.price));
      const closePoints = markerSet.closes
        .map((fill) => ({
          tick: toBucketTick(Number(fill.tick)),
          price: Number(fill.vwap ?? fill.price),
          side: fill.action === "BUY" ? "BUY" : "SELL",
        }))
        .filter((fill) => Number.isFinite(fill.tick) && Number.isFinite(fill.price));
      const dealMarks =
        ticker === selectedTicker
          ? tasTrades
              .map((trade) => ({
                tick: toBucketTick(Number(trade.tick)),
                price: Number(trade.price),
              }))
              .filter((trade) => Number.isFinite(trade.tick) && Number.isFinite(trade.price))
          : [];
      const decimals = decimalsByTicker.get(ticker) ?? 2;
      const levels = buildOrderLevelsForTicker({
        orders,
        ticker,
        decimals,
        includeRiskLevels: hasActivePositionForTicker(ticker),
      });
      next.set(ticker, {
        candles: tickerCandles,
        dealPoints: dealMarks,
        openFillPoints: openPoints,
        closeFillPoints: closePoints,
        orderLevels: levels,
      });
    });
    return next;
  }, [
    activeMnaPairs,
    decimalsByTicker,
    fills,
    history,
    isMergerArbCase,
    mnaHistoryByTicker,
    orders,
    hasActivePositionForTicker,
    selectedTicker,
    tasTrades,
  ]);

  const renderMnaTickerChart = ({ pair, ticker }) => {
      const model = mnaChartModelsByTicker.get(ticker);
      const candlesForTicker = model?.candles || [];
      const mnaChartHeight = orderbookDisplayMode === "graph" ? 520 : 360;
      if (!candlesForTicker.length) {
        return <div className="muted">No candle history yet for {ticker}.</div>;
      }

      const referenceLevels = [];
      if (isMnaPeerPriceVisible(pair.id, ticker)) {
        const acquirerAnchor = firstFinite(
          getTickerLivePrice(pair.acquirerTicker),
          getMnaStartingPrice(pair, pair.acquirerTicker)
        );
        const targetPrice = deriveMnaTargetPrice(pair, acquirerAnchor);
        if (Number.isFinite(targetPrice)) {
          referenceLevels.push({
            price: targetPrice,
            label: `${pair.targetTicker} deal value`,
            color: "rgba(124, 58, 237, 0.92)",
            style: "dash",
          });
        }
        const startingPrice = getMnaStartingPrice(pair, ticker);
        if (Number.isFinite(startingPrice)) {
          referenceLevels.push({
            price: startingPrice,
            label: `${ticker} start`,
            color: "rgba(14, 116, 144, 0.92)",
            style: "dot",
          });
        }
      }

      const ticks = candlesForTicker.map((candle) => candle.tick);
      const xStart = ticks[0];
      const xEnd = ticks[ticks.length - 1];
      const orderLines = [
        ...model.orderLevels.limit.map((level) => ({
          price: level.price,
          label: level.side === "BUY" ? `LMT B (${level.count})` : `LMT S (${level.count})`,
          color: level.side === "BUY" ? "rgba(37, 99, 235, 0.9)" : "rgba(249, 115, 22, 0.9)",
          style: "dot",
          width: 1.25,
        })),
        ...model.orderLevels.stopLoss.map((level) => ({
          price: level.price,
          label: `SL (${level.count})`,
          color: "rgba(220, 38, 38, 0.85)",
          style: "dash",
        })),
        ...model.orderLevels.takeProfit.map((level) => ({
          price: level.price,
          label: `TP (${level.count})`,
          color: "rgba(22, 163, 74, 0.85)",
          style: "dash",
        })),
      ];
      const mnaScaleKey = `mna:${pair.id}:${ticker}`;
      const yAxisScaleConfig = resolvePlotlyYAxisConfig(
        mnaScaleKey,
        candlesForTicker,
        [orderLines, referenceLevels],
        [model.dealPoints, model.openFillPoints, model.closeFillPoints]
      );

      const plotlyDataForPair = [
        {
          type: "candlestick",
          x: ticks,
          open: candlesForTicker.map((candle) => candle.open),
          high: candlesForTicker.map((candle) => candle.high),
          low: candlesForTicker.map((candle) => candle.low),
          close: candlesForTicker.map((candle) => candle.close),
          increasing: { line: { color: "#2E8B57" } },
          decreasing: { line: { color: "#C0392B" } },
        },
        ...(model.dealPoints.length
          ? [
              {
                type: "scatter",
                mode: "markers",
                name: "Deals",
                x: model.dealPoints.map((point) => point.tick),
                y: model.dealPoints.map((point) => point.price),
                marker: { size: 4, color: "rgba(148, 163, 184, 0.55)" },
              },
            ]
          : []),
        ...buildHorizontalTraces(xStart, xEnd, orderLines),
        ...buildHorizontalTraces(xStart, xEnd, referenceLevels),
        ...(model.openFillPoints.length
          ? [
              {
                type: "scatter",
                mode: "markers",
                name: "Position Open",
                x: model.openFillPoints.map((fill) => fill.tick),
                y: model.openFillPoints.map((fill) => fill.price),
                marker: {
                  size: 11,
                  symbol: model.openFillPoints.map((fill) =>
                    fill.side === "BUY" ? "triangle-up" : "triangle-down"
                  ),
                  color: model.openFillPoints.map((fill) =>
                    fill.side === "BUY" ? "#22c55e" : "#ef4444"
                  ),
                  line: { width: 1.5, color: "rgba(15, 23, 42, 0.25)" },
                },
              },
            ]
          : []),
        ...(model.closeFillPoints.length
          ? [
              {
                type: "scatter",
                mode: "markers",
                name: "Position Close",
                x: model.closeFillPoints.map((fill) => fill.tick),
                y: model.closeFillPoints.map((fill) => fill.price),
                marker: {
                  size: 9,
                  symbol: model.closeFillPoints.map((fill) =>
                    fill.side === "BUY" ? "triangle-up" : "triangle-down"
                  ),
                  color: model.closeFillPoints.map((fill) =>
                    fill.side === "BUY" ? "#22c55e" : "#ef4444"
                  ),
                  line: { width: 1.2, color: "rgba(15, 23, 42, 0.25)" },
                  opacity: 0.85,
                },
              },
            ]
          : []),
      ];

      const plotlyLayoutForPair = {
        paper_bgcolor: chartPlotBg,
        plot_bgcolor: chartPlotBg,
        margin: { l: 40, r: 20, t: 30, b: 30 },
        dragmode: "zoom",
        font: { color: chartTextColor },
        xaxis: {
          title: "Tick",
          gridcolor: chartGridColor,
          tickfont: { size: 10, color: chartTextColor },
          rangeslider: { visible: showRangeSlider },
        },
        yaxis: {
          title: "Price",
          gridcolor: chartGridColor,
          tickfont: { size: 10, color: chartTextColor },
          ...yAxisScaleConfig,
        },
        uirevision: `${pair.id}-${ticker}`,
      };

      return (
        <CandlesRenderer
          renderer={chartRenderer}
          candles={candlesForTicker}
          dealPoints={model.dealPoints}
          openFillPoints={model.openFillPoints}
          closeFillPoints={model.closeFillPoints}
          limitLevels={model.orderLevels.limit}
          stopLossLevels={model.orderLevels.stopLoss}
          takeProfitLevels={model.orderLevels.takeProfit}
          referenceLevels={referenceLevels}
          showRangeSlider={showRangeSlider}
          theme={theme}
          height={mnaChartHeight}
          plotlyData={plotlyDataForPair}
          plotlyLayout={plotlyLayoutForPair}
          plotlyConfig={chartConfig}
          autoScale={autoScaleCharts}
          onPlotlyRelayout={(ev) => updatePlotlyScaleLock(mnaScaleKey, ev)}
          onChartTradeIntent={(button, price) =>
            handleChartTradeIntentForTicker(ticker, button, price)
          }
          chartTradingEnabled={Boolean(config && chartMouseTrading)}
        />
      );
    };

  const openPositionRows = useMemo(() => {
    return securities
      .map((sec) => {
        const ticker = sec.ticker;
        if (!ticker) return null;
        const position = positionMap.get(ticker) || null;
        const qty = Number(position?.qty ?? sec.position ?? sec.pos ?? sec.qty ?? 0);
        if (!Number.isFinite(qty) || qty === 0) return null;
        const entry = Number(position?.avg ?? sec.avg ?? sec.vwap ?? sec.price ?? NaN);
        const last = Number(sec.last);
        const bid = Number(sec.bid);
        const ask = Number(sec.ask);
        const mid =
          Number.isFinite(bid) && Number.isFinite(ask)
            ? (bid + ask) / 2
            : Number.isFinite(last)
              ? last
              : Number.isFinite(bid)
                ? bid
                : Number.isFinite(ask)
                  ? ask
                  : null;
        const pnl =
          Number.isFinite(entry) && Number.isFinite(mid)
            ? qty * (mid - entry)
            : null;
        return {
          ticker,
          qty,
          entry: Number.isFinite(entry) ? entry : null,
          pnl,
        };
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs(b.qty) - Math.abs(a.qty));
  }, [positionMap, securities]);
  const latestRealized = realizedSeries.length
    ? realizedSeries[realizedSeries.length - 1]?.value
    : null;
  const latestUnrealized = unrealizedSeries.length
    ? unrealizedSeries[unrealizedSeries.length - 1]?.value
    : null;
  const realizedTone = latestRealized != null ? (latestRealized < 0 ? "negative" : "positive") : "";
  const unrealizedTone =
    latestUnrealized != null ? (latestUnrealized < 0 ? "negative" : "positive") : "";
  const myExecs = useMemo(() => {
    const list = fills
      .filter((fill) => (selectedTicker ? fill.ticker === selectedTicker : true))
      .sort((a, b) => {
        const tickA = Number(a.tick ?? 0);
        const tickB = Number(b.tick ?? 0);
        if (tickA !== tickB) return tickB - tickA;
        return Number(b.order_id ?? 0) - Number(a.order_id ?? 0);
      });
    return list.slice(0, 120);
  }, [fills, selectedTicker]);

  const dismissedNewsSet = useMemo(
    () => new Set(dismissedNewsIds),
    [dismissedNewsIds]
  );

  const clearAllNews = useCallback(() => {
    const maxKey = Math.max(
      -1,
      ...newsItems.map((item) =>
        Number.isFinite(Number(item.sortKey)) ? Number(item.sortKey) : -1
      )
    );
    clearNewsSortKeyRef.current = maxKey >= 0 ? maxKey : null;
    if (maxKey >= 0) {
      newsSinceRef.current = maxKey;
    }
    setDismissedNewsIds((prev) => {
      const next = new Set(prev);
      newsItems.forEach((item) => next.add(item.id));
      return Array.from(next);
    });
    setNewsItems([]);
  }, [newsItems]);

  const newsDeck = useMemo(() => {
    const sorted = [...newsItems].sort(
      (a, b) => (b.receivedAt ?? 0) - (a.receivedAt ?? 0)
    );
    return sorted.filter((item) => !dismissedNewsSet.has(item.id)).slice(0, 6);
  }, [dismissedNewsSet, newsItems]);

  const filteredTerminalLines = useMemo(() => {
    if (!logFilters.length) return [];
    const allowed = new Set(logFilters);
    return terminalLines.filter((line) => allowed.has(line.category));
  }, [logFilters, terminalLines]);

  useEffect(() => {
    if (!terminalUnlocked) return;
    const container = terminalBodyRef.current;
    if (!container) return;
    const syncScroll = () => {
      container.scrollTop = container.scrollHeight;
    };
    // Double RAF to catch layout + font rendering before we stick the scroll.
    const raf1 = requestAnimationFrame(() => {
      syncScroll();
      const raf2 = requestAnimationFrame(syncScroll);
      container.__raf2 = raf2;
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (container.__raf2) cancelAnimationFrame(container.__raf2);
    };
  }, [terminalLines.length, filteredTerminalLines.length, terminalUnlocked]);

  useEffect(() => {
    if (!terminalUnlocked) return;
    if (showTutorial) return;
    try {
      const seen = localStorage.getItem(TUTORIAL_SEEN_KEY);
      if (!seen) {
        setShowTutorial(true);
      }
    } catch {
      setShowTutorial(true);
    }
  }, [showTutorial, terminalUnlocked]);

  const requestMetricRows = useMemo(() => {
    return Object.entries(requestMetrics)
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [requestMetrics]);

  const perfRows = useMemo(() => {
    return FAST_POLL_ENDPOINTS.map((endpoint) => ({
      ...endpoint,
      points: perfSeries[endpoint.key] || [],
    })).filter((row) => row.points.length > 1);
  }, [perfSeries]);
  const shortcuts = [
    { keys: "Space", action: "Bulk cancel open orders." },
    { keys: "B", action: "Switch to Book Trader view." },
    { keys: "L", action: "Switch to Ladder Trader view." },
    { keys: "C", action: "Re-center order book view." },
    { keys: "R", action: "Re-center order book view (legacy alias)." },
    { keys: "A", action: "Add another order book panel." },
    { keys: "Esc", action: "Close open pop-ups." },
  ];

  const dismissTutorial = useCallback(() => {
    setShowTutorial(false);
    try {
      localStorage.setItem(TUTORIAL_SEEN_KEY, "true");
    } catch {
      // If storage is blocked, we still let them continue.
    }
  }, []);

  const formatMs = useCallback((value) => {
    if (!Number.isFinite(value)) return "—";
    return `${Math.round(value)}`;
  }, []);

  const buildSparklinePoints = useCallback((points, width = 160, height = 44) => {
    if (!points.length) return "";
    const values = points.map((point) => point.ms);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    return points
      .map((point, index) => {
        const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
        const y = height - ((point.ms - min) / range) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, []);
  const buildPnlSparkline = useCallback((series, width = 96, height = 26) => {
    if (!series.length) return "";
    const values = series.map((entry) => entry.value).filter(Number.isFinite);
    if (!values.length) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    return values
      .map((value, index) => {
        const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
        const y = height - ((value - min) / range) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, []);

  const realizedSparkline = useMemo(
    () => buildPnlSparkline(realizedSeries.slice(-60)),
    [buildPnlSparkline, realizedSeries]
  );
  const unrealizedSparkline = useMemo(
    () => buildPnlSparkline(unrealizedSeries.slice(-60)),
    [buildPnlSparkline, unrealizedSeries]
  );

  const canConnect =
    mode === "local"
      ? localConfig.apiKey
      : remoteConfig.authMode === "header"
        ? remoteConfig.authHeader
        : remoteConfig.username && remoteConfig.password;
  // Status copy tweak: show "idling" without sounding alarmist (yellow is enough drama). 😅
  const statusLabel = isCaseStopped ? "Connected, idling" : connectionStatus;
  const statusClass = isCaseStopped
    ? "warning"
    : connectionStatus === "Connected"
      ? "online"
      : "offline";
  const isConnected = connectionStatus === "Connected";
  const requiresConnectionClass = isConnected ? "" : "card-disabled";
  const caseLabel = caseInfo?.name || caseInfo?.case_id || "No case selected";
  const tickLabel = caseInfo
    ? `${caseInfo.tick ?? "—"} / ${caseInfo.ticks_per_period ?? "—"}`
    : "—";
  const tickProgress = useMemo(() => {
    const tick = Number(caseInfo?.tick);
    const total = Number(caseInfo?.ticks_per_period);
    if (!Number.isFinite(total) || total <= 0) return isConnected ? 0 : null;
    if (!Number.isFinite(tick)) return 0;
    const normalizedTick = Math.max(1, tick);
    return Math.min(1, Math.max(0, normalizedTick / total));
  }, [caseInfo?.tick, caseInfo?.ticks_per_period, isConnected]);
  const versionMinor = Number(import.meta.env.VITE_VERSION_MINOR ?? 0) || 0;
  const versionLabel = `V${versionMajor}.${versionMinor}`;
  const tickBarWidth =
    tickProgress && tickProgress > 0
      ? `clamp(6px, ${(tickProgress * 100).toFixed(2)}%, 100%)`
      : "0px";
  const isGraphOnlyMode = orderbookDisplayMode === "graph";
  const showOrderbookPanels = !isGraphOnlyMode;
  const showCandlesPanel = true;
  const splitOrderbookLayout = showOrderbookPanels && !isMultiBook;
  const chartPanelHeight = showOrderbookPanels
    ? isMultiBook
      ? 320
      : 420
    : isMergerArbCase
      ? 560
      : 660;

  const buildTickerChartModel = useCallback(
    (ticker, rows, includeDeals = false) => {
      const tickerCandles = aggregateCandles(rows || [], CANDLE_BUCKET);
      const markerSet = buildFillMarkersForTicker(fills, ticker);
      const openPoints = markerSet.opens
        .map((fill) => ({
          tick: toBucketTick(Number(fill.tick)),
          price: Number(fill.vwap ?? fill.price),
          side: fill.action === "BUY" ? "BUY" : "SELL",
        }))
        .filter((fill) => Number.isFinite(fill.tick) && Number.isFinite(fill.price));
      const closePoints = markerSet.closes
        .map((fill) => ({
          tick: toBucketTick(Number(fill.tick)),
          price: Number(fill.vwap ?? fill.price),
          side: fill.action === "BUY" ? "BUY" : "SELL",
        }))
        .filter((fill) => Number.isFinite(fill.tick) && Number.isFinite(fill.price));
      const panelDeals = includeDeals
        ? tasTrades
            .map((trade) => ({
              tick: toBucketTick(Number(trade.tick)),
              price: Number(trade.price),
            }))
            .filter((trade) => Number.isFinite(trade.tick) && Number.isFinite(trade.price))
        : [];
      const decimals = decimalsByTicker.get(ticker) ?? 2;
      const levels = buildOrderLevelsForTicker({
        orders,
        ticker,
        decimals,
        includeRiskLevels: hasActivePositionForTicker(ticker),
      });
      return {
        candles: tickerCandles,
        dealPoints: panelDeals,
        openFillPoints: openPoints,
        closeFillPoints: closePoints,
        orderLevels: levels,
      };
    },
    [decimalsByTicker, fills, hasActivePositionForTicker, orders, tasTrades]
  );

  const renderChartSettings = () => (
    <div className="chart-settings">
      <label className="chart-control">
        <span>Renderer</span>
        <select
          value={chartRenderer}
          onChange={(event) => setChartRenderer(event.target.value)}
        >
          {CANDLE_RENDERERS.map((renderer) => (
            <option key={renderer.id} value={renderer.id}>
              {renderer.label}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={autoScaleCharts}
          onChange={(event) => setAutoScaleCharts(event.target.checked)}
        />
        Auto scale charts
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={showRangeSlider}
          disabled={!chartRendererMeta.supportsRangeSlider}
          onChange={(event) => setShowRangeSlider(event.target.checked)}
        />
        Enable range slider
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={chartMouseTrading}
          onChange={(event) => setChartMouseTrading(event.target.checked)}
        />
        Enable chart mouse trading
      </label>
      <label className="chart-control chart-control--small">
        <span>Quick Qty</span>
        <input
          type="number"
          min="1"
          step="1"
          value={orderDraft.quantity}
          onChange={(event) =>
            setOrderDraft((prev) => ({
              ...prev,
              quantity: event.target.value,
            }))
          }
        />
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={Boolean(bracketDefaults.enabled)}
          onChange={(event) =>
            setBracketDefaults((prev) => ({
              ...prev,
              enabled: event.target.checked,
            }))
          }
        />
        Apply default TP/SL to quick orders
      </label>
      <label className="chart-control chart-control--small">
        <span>SL Offset (%)</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={bracketDefaults.stopLossOffset}
          disabled={!bracketDefaults.enabled}
          onChange={(event) =>
            setBracketDefaults((prev) => ({
              ...prev,
              stopLossOffset: event.target.value,
            }))
          }
        />
      </label>
      <label className="chart-control chart-control--small">
        <span>TP Offset (%)</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={bracketDefaults.takeProfitOffset}
          disabled={!bracketDefaults.enabled}
          onChange={(event) =>
            setBracketDefaults((prev) => ({
              ...prev,
              takeProfitOffset: event.target.value,
            }))
          }
        />
      </label>
      <div className="muted chart-engine-hint">
        TP/SL offsets are interpreted as percentages from the order reference price.
      </div>
      <div className="muted chart-engine-hint">{chartRendererMeta.description}</div>
      {!chartRendererMeta.supportsRangeSlider && (
        <div className="muted chart-engine-hint">
          Range slider is unavailable for this renderer.
        </div>
      )}
      <div className="muted chart-engine-hint">
        Chart trading: LMB = buy (below mid limit, above mid market), RMB = sell (above mid limit, below mid market).
        {chartMouseTrading ? " Trading is active." : " Enable it before sending chart orders."}
      </div>
      {isMergerArbCase && (
        <div className="muted chart-engine-hint">
          Merger mode opens target/acquirer charts in pairs and draws deal and start-price lines for fast orientation.
        </div>
      )}
      {chartRendererMeta.supportsIndicators ? (
        <details className="indicator-menu">
          <summary>Indicators ({INDICATORS.length})</summary>
          <div className="indicator-list">
            {INDICATORS.map((indicator) => (
              <label key={indicator.id} className="indicator-row">
                <input
                  type="checkbox"
                  checked={Boolean(indicatorState[indicator.id])}
                  onChange={() =>
                    setIndicatorState((prev) => ({
                      ...prev,
                      [indicator.id]: !prev[indicator.id],
                    }))
                  }
                />
                <span>{indicator.label}</span>
                <button
                  type="button"
                  className="indicator-info"
                  aria-label={`About ${indicator.label}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setIndicatorInfo(indicator);
                  }}
                >
                  i
                </button>
              </label>
            ))}
          </div>
        </details>
      ) : (
        <div className="muted chart-engine-hint">
          Indicators are currently available only in the Plotly renderer.
        </div>
      )}
    </div>
  );

  const renderChartPanel = ({
    inline = false,
    ticker = null,
    title = null,
    showSettingsToggle = true,
  } = {}) => {
    const showMnaWorkspace = isMergerArbCase && !ticker;
    const activeTicker = ticker || selectedTicker;
    const usingPrimaryTicker = !ticker || ticker === selectedTicker;

    let chartBody = null;
    let panelTitle = title || "Candles";
    if (showMnaWorkspace) {
      chartBody = (
        <MnaPairsSection
          activePairIds={activeMnaPairIds}
          pairOptions={MNA_CASE_PAIRS}
          pairById={MNA_CASE_PAIR_BY_ID}
          onAddPair={addMnaPair}
          onRemovePair={removeMnaPairAt}
          onChangePair={updateMnaPairAt}
          canAddPair={canAddMnaPair}
          isPeerPriceVisible={isMnaPeerPriceVisible}
          onPeerPriceToggle={setMnaPeerPriceVisible}
          renderTickerChart={renderMnaTickerChart}
        />
      );
    } else {
      panelTitle = title || (activeTicker ? `${activeTicker} Candles` : "Candles");
      const tickerRows = usingPrimaryTicker ? history : bookHistoryByTicker[activeTicker] || [];
      const model = usingPrimaryTicker
        ? {
            candles,
            dealPoints,
            openFillPoints,
            closeFillPoints,
            orderLevels,
          }
        : buildTickerChartModel(activeTicker, tickerRows, false);

      if (!model.candles.length) {
        chartBody = <div className="muted">No candle history yet for {activeTicker || "ticker"}.</div>;
      } else {
        const referenceLevels = usingPrimaryTicker ? selectedMnaReferenceLevels : [];
        const ticks = model.candles.map((candle) => candle.tick);
        const xStart = ticks[0];
        const xEnd = ticks[ticks.length - 1];
        const orderLines = [
          ...model.orderLevels.limit.map((level) => ({
            price: level.price,
            label: level.side === "BUY" ? `LMT B (${level.count})` : `LMT S (${level.count})`,
            color: level.side === "BUY" ? "rgba(37, 99, 235, 0.9)" : "rgba(249, 115, 22, 0.9)",
            style: "dot",
            width: 1.25,
          })),
          ...model.orderLevels.stopLoss.map((level) => ({
            price: level.price,
            label: `SL (${level.count})`,
            color: "rgba(220, 38, 38, 0.85)",
            style: "dash",
          })),
          ...model.orderLevels.takeProfit.map((level) => ({
            price: level.price,
            label: `TP (${level.count})`,
            color: "rgba(22, 163, 74, 0.85)",
            style: "dash",
          })),
        ];
        const panelScaleKey = `panel:${activeTicker || "none"}`;
        const yAxisScaleConfig = resolvePlotlyYAxisConfig(
          panelScaleKey,
          model.candles,
          [orderLines, referenceLevels],
          [model.dealPoints, model.openFillPoints, model.closeFillPoints]
        );

        const panelPlotlyData = [
          {
            type: "candlestick",
            x: ticks,
            open: model.candles.map((candle) => candle.open),
            high: model.candles.map((candle) => candle.high),
            low: model.candles.map((candle) => candle.low),
            close: model.candles.map((candle) => candle.close),
            increasing: { line: { color: "#2E8B57" } },
            decreasing: { line: { color: "#C0392B" } },
          },
          ...(model.dealPoints.length
            ? [
                {
                  type: "scatter",
                  mode: "markers",
                  name: "Deals",
                  x: model.dealPoints.map((point) => point.tick),
                  y: model.dealPoints.map((point) => point.price),
                  marker: { size: 4, color: "rgba(148, 163, 184, 0.55)" },
                },
              ]
            : []),
          ...buildHorizontalTraces(xStart, xEnd, orderLines),
          ...buildHorizontalTraces(xStart, xEnd, referenceLevels),
          ...(model.openFillPoints.length
            ? [
                {
                  type: "scatter",
                  mode: "markers",
                  name: "Position Open",
                  x: model.openFillPoints.map((fill) => fill.tick),
                  y: model.openFillPoints.map((fill) => fill.price),
                  marker: {
                    size: 11,
                    symbol: model.openFillPoints.map((fill) =>
                      fill.side === "BUY" ? "triangle-up" : "triangle-down"
                    ),
                    color: model.openFillPoints.map((fill) =>
                      fill.side === "BUY" ? "#22c55e" : "#ef4444"
                    ),
                    line: { width: 1.5, color: "rgba(15, 23, 42, 0.25)" },
                  },
                },
              ]
            : []),
          ...(model.closeFillPoints.length
            ? [
                {
                  type: "scatter",
                  mode: "markers",
                  name: "Position Close",
                  x: model.closeFillPoints.map((fill) => fill.tick),
                  y: model.closeFillPoints.map((fill) => fill.price),
                  marker: {
                    size: 9,
                    symbol: model.closeFillPoints.map((fill) =>
                      fill.side === "BUY" ? "triangle-up" : "triangle-down"
                    ),
                    color: model.closeFillPoints.map((fill) =>
                      fill.side === "BUY" ? "#22c55e" : "#ef4444"
                    ),
                    line: { width: 1.2, color: "rgba(15, 23, 42, 0.25)" },
                    opacity: 0.85,
                  },
                },
              ]
            : []),
          ...(usingPrimaryTicker ? indicatorTraces : []),
        ];

        const panelPlotlyLayout = {
          paper_bgcolor: chartPlotBg,
          plot_bgcolor: chartPlotBg,
          margin: { l: 40, r: 20, t: 30, b: 30 },
          dragmode: "zoom",
          font: { color: chartTextColor },
          xaxis: {
            title: "Tick",
            gridcolor: chartGridColor,
            tickfont: { size: 10, color: chartTextColor },
            rangeslider: { visible: showRangeSlider },
          },
          yaxis: {
            title: "Price",
            gridcolor: chartGridColor,
            tickfont: { size: 10, color: chartTextColor },
            ...yAxisScaleConfig,
          },
          ...(usingPrimaryTicker && showOscillatorAxis
            ? {
                yaxis2: {
                  overlaying: "y",
                  side: "right",
                  showgrid: false,
                  tickfont: { size: 9, color: chartTextColor },
                },
              }
            : {}),
          uirevision: activeTicker,
          ...(usingPrimaryTicker ? chartView : {}),
        };

        chartBody = (
          <CandlesRenderer
            renderer={chartRenderer}
            candles={model.candles}
            dealPoints={model.dealPoints}
            openFillPoints={model.openFillPoints}
            closeFillPoints={model.closeFillPoints}
            limitLevels={model.orderLevels.limit}
            stopLossLevels={model.orderLevels.stopLoss}
            takeProfitLevels={model.orderLevels.takeProfit}
            referenceLevels={referenceLevels}
            showRangeSlider={showRangeSlider}
            theme={theme}
            height={chartPanelHeight}
            plotlyData={panelPlotlyData}
            plotlyLayout={panelPlotlyLayout}
            plotlyConfig={chartConfig}
            autoScale={autoScaleCharts}
            onPlotlyRelayout={(ev) => {
              updatePlotlyScaleLock(panelScaleKey, ev);
              if (usingPrimaryTicker) handlePlotlyRelayout(ev);
            }}
            onChartTradeIntent={(button, price) =>
              handleChartTradeIntentForTicker(activeTicker, button, price)
            }
            chartTradingEnabled={Boolean(config && activeTicker && chartMouseTrading)}
          />
        );
      }
    }

    if (showMnaWorkspace) {
      return (
        <div className={`orderbook-candles ${inline ? "orderbook-candles--inline" : ""} chart-view-root`}>
          <div className="card-title chart-view-title">Chart View</div>
          <section className="chart-view-subsection">
            <div className="chart-view-subsection-header">
              <strong>Chart Settings</strong>
              <button
                type="button"
                className="ghost"
                onClick={() => setShowChartSettings((prev) => !prev)}
              >
                {showChartSettings ? "Hide Settings" : "Show Settings"}
              </button>
            </div>
            {showChartSettings ? (
              renderChartSettings()
            ) : (
              <div className="muted chart-view-subsection-note">
                Settings are collapsed. Expand to adjust renderer, mouse trading, and TP/SL defaults.
              </div>
            )}
          </section>
          <section className="chart-view-subsection">
            <div className="chart-view-subsection-header">
              <strong>Pairs</strong>
              <span className="muted chart-view-subsection-note">
                Deal value and start price are shown by default on each pair chart.
              </span>
            </div>
            {chartBody}
          </section>
        </div>
      );
    }

    return (
      <div className={`orderbook-candles ${inline ? "orderbook-candles--inline" : ""}`}>
        <div className="card-title chart-header">
          <span>{panelTitle}</span>
          {showSettingsToggle && (
            <button
              type="button"
              className="ghost"
              onClick={() => setShowChartSettings((prev) => !prev)}
            >
              Chart Settings
            </button>
          )}
        </div>
        {chartBody}
        {showChartSettings && renderChartSettings()}
      </div>
    );
  };
  const connectedHost = config ? formatHost(config.baseUrl) : "—";
  const routeSteps = useMemo(() => {
    if (connectionStatus !== "Connected") return [];
    if (mode === "local") {
      const target = formatHost(localConfig.baseUrl);
      return useProxyLocal
        ? ["UI", "localhost:3001", target]
        : ["UI", target];
    }
    const target = formatHost(remoteConfig.baseUrl);
    if (!useProxyRemote) return ["UI", target];
    if (proxyTargetRemote === "remote") {
      const proxyHost = cloudProxyUrl.trim()
        ? formatHost(cloudProxyUrl.trim())
        : "remote-proxy";
      return ["UI", proxyHost, target];
    }
    return ["UI", "localhost:3001", target];
  }, [
    cloudProxyUrl,
    connectionStatus,
    localConfig.baseUrl,
    mode,
    proxyTargetRemote,
    remoteConfig.baseUrl,
    useProxyLocal,
    useProxyRemote,
  ]);

  useEffect(() => {
    const stale =
      connectionStatus === "Connected" &&
      lastBookUpdateAt > 0 && now - lastBookUpdateAt > 3000;
    if (stale) {
      hadStaleRef.current = true;
    }
  }, [connectionStatus, lastBookUpdateAt, lastConnectAt, now]);

  return (
    <div className="app" data-theme={theme} onContextMenu={(event) => event.preventDefault()}>
      <div className="toast-stack" aria-live="polite">
        {tenders.map((tender) => (
          <div key={tender.tender_id} className="toast tender">
            <div className="tender-main">
              <div className="tender-title">
                {highlightNumbers(tender.caption || `Tender ${tender.tender_id}`)}
              </div>
              <div className="tender-sub">
                {highlightNumbers(
                  `${tender.action} ${tender.quantity} @ ${tender.price ?? "MKT"} • ${tender.ticker}`
                )}
              </div>
            </div>
            {!tender.is_fixed_bid && (
              <input
                className="tender-input"
                type="number"
                placeholder="Price"
                value={tenderPrices[tender.tender_id] || ""}
                onChange={(event) =>
                  setTenderPrices((prev) => ({
                    ...prev,
                    [tender.tender_id]: event.target.value,
                  }))
                }
              />
            )}
            <div className="tender-actions">
              <button
                type="button"
                className="primary small"
                onClick={() => acceptTender(tender)}
              >
                Accept
              </button>
              <button
                type="button"
                className="ghost small"
                onClick={() => declineTender(tender.tender_id)}
              >
                Decline
              </button>
            </div>
          </div>
        ))}
        {notifications.map((note) => (
          <div key={note.id} className={`toast ${note.tone}`}>
            {note.message}
          </div>
        ))}
      </div>
      <div className="news-stack" aria-live="polite">
        {newsDeck.length > 0 && (
          <button type="button" className="news-clear" onClick={clearAllNews}>
            Clear all
          </button>
        )}
        {newsDeck.map((item) => {
          const ageMs = Math.max(0, now - (item.receivedAt ?? now));
          const remaining = Math.max(0, NEWS_TTL_MS - ageMs);
          const progress = Math.max(0, Math.min(1, remaining / NEWS_TTL_MS));
          return (
            <div key={item.id} className="news-card">
              <button
                type="button"
                className="news-close"
                onClick={() => dismissNews(item.id)}
                aria-label="Dismiss news"
              >
                ×
              </button>
              <div className="news-card__body">{item.text}</div>
              <div className="news-timer">
                <span className="news-timer__bar" style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <header className="topbar">
        <div className="topbar-left">
          <img className="topbar-logo" src={logoUrl} alt="Privod Johnny logo" />
          <div className="topbar-title">
            <div className="topbar-name-row">
              <span className="topbar-name">Privod Johnny</span>
              <span className="topbar-version">{versionLabel}</span>
            </div>
            <span className={`status-pill status-pill--compact ${statusClass}`}>
              {statusLabel}
            </span>
          </div>
        </div>
        <div className="topbar-center">
          <div className="topbar-stat">
            <span className="topbar-label">Case</span>
            <strong>{caseLabel}</strong>
          </div>
          <div className="topbar-stat">
            <span className="topbar-label">Tick</span>
            <strong>{tickLabel}</strong>
            {tickProgress != null && (
              <div className="tick-bar tick-bar--mini">
                <span
                  className="tick-bar__fill"
                  style={{
                    width: tickBarWidth,
                  }}
                />
              </div>
            )}
          </div>
        </div>
        <div className="topbar-right">
          {routeSteps.length > 0 && (
            <div className="status-route status-route--compact">
              {routeSteps.map((step, index) => (
                <span key={`${step}-${index}`} className="status-route__step">
                  {step}
                </span>
              ))}
            </div>
          )}
          <button
            type="button"
            className="ghost shortcuts-button"
            onClick={() => setShowShortcuts(true)}
          >
            <span className="info-icon" aria-hidden="true">i</span>
            Shortcuts
          </button>
          <button
            type="button"
            className="theme-toggle theme-toggle--compact"
            aria-pressed={theme === "dark"}
            onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
          >
            <span className="theme-toggle__label">{theme === "dark" ? "Dark" : "Light"}</span>
            <span className="theme-toggle__track">
              <span className="theme-toggle__thumb" />
            </span>
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <section className="card connection-card">
            <div className="card-title">Connection</div>
            {isConnected ? (
              <div className="connection-compact">
                <div>
                  <div className="muted">Connected to {connectedHost}</div>
                  <div className="muted">Case: {caseLabel}</div>
                </div>
                <button type="button" className="ghost" onClick={disconnect}>
                  Disconnect
                </button>
              </div>
            ) : (
              <>
                <div className="segmented">
                  <button
                    type="button"
                    className={mode === "local" ? "active" : ""}
                    onClick={() => setMode("local")}
                  >
                    Local (Client)
                  </button>
                  <button
                    type="button"
                    className={mode === "remote" ? "active" : ""}
                    onClick={() => setMode("remote")}
                  >
                    Remote (DMA)
                  </button>
                </div>

                {mode === "local" ? (
                  <div className="form-grid">
                    <label>
                      Base URL
                      <input
                        value={localConfig.baseUrl}
                        onChange={(event) =>
                          setLocalConfig((prev) => ({ ...prev, baseUrl: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      API Key
                      <input
                        value={localConfig.apiKey}
                        onChange={(event) =>
                          setLocalConfig((prev) => ({ ...prev, apiKey: event.target.value }))
                        }
                      />
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={useProxyLocal}
                        onChange={(event) => setUseProxyLocal(event.target.checked)}
                      />
                      Use proxy
                    </label>
                    {useProxyLocal && (
                      <label>
                        Local proxy URL
                        <input
                          value={localProxyUrl}
                          onChange={(event) => setLocalProxyUrl(event.target.value)}
                          placeholder="http://localhost:3001"
                        />
                      </label>
                    )}
                  </div>
                ) : (
                  <div className="form-grid">
                    <label>
                      Base URL
                      <input
                        value={remoteConfig.baseUrl}
                        onChange={(event) =>
                          setRemoteConfig((prev) => ({ ...prev, baseUrl: event.target.value }))
                        }
                      />
                    </label>
                    <div className="muted">
                      DMA port is set from the case selector below. Proxy requests now honor the
                      selected port.
                    </div>
                    <label>
                      Case
                      <select
                        value={remoteConfig.caseId}
                        onChange={(event) => {
                          const nextCase = event.target.value;
                          const defaultPort = resolveCasePort(nextCase, remoteConfig.algoPort);
                          setRemoteConfig((prev) => ({
                            ...prev,
                            caseId: nextCase,
                            baseUrl: defaultPort ? updateUrlPort(prev.baseUrl, defaultPort) : prev.baseUrl,
                            algoPort:
                              nextCase === "algo-mm"
                                ? prev.algoPort ?? DMA_CASES.find((item) => item.id === "algo-mm")?.ports?.[0]
                                : prev.algoPort,
                          }));
                        }}
                      >
                        {DMA_CASES.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {remoteConfig.caseId === "algo-mm" && (
                      <label>
                        Algo MM port
                        <select
                          value={remoteConfig.algoPort}
                          onChange={(event) => {
                            const port = Number(event.target.value);
                            setRemoteConfig((prev) => ({
                              ...prev,
                              algoPort: port,
                              baseUrl: updateUrlPort(prev.baseUrl, port),
                            }));
                          }}
                        >
                          {DMA_CASES.find((item) => item.id === "algo-mm")?.ports?.map((port) => (
                            <option key={port} value={port}>
                              {port}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>
                      Auth mode
                      <select
                        value={remoteConfig.authMode}
                        onChange={(event) =>
                          setRemoteConfig((prev) => ({ ...prev, authMode: event.target.value }))
                        }
                      >
                        <option value="header">Authorization header</option>
                        <option value="basic">Username + password</option>
                      </select>
                    </label>
                    {remoteConfig.authMode === "header" ? (
                      <label>
                        Authorization
                        <input
                          type="password"
                          value={remoteConfig.authHeader}
                          onChange={(event) =>
                            setRemoteConfig((prev) => ({ ...prev, authHeader: event.target.value }))
                          }
                          placeholder="Basic XXXXXXXXXX"
                        />
                      </label>
                    ) : (
                      <>
                        <label>
                          Username
                          <input
                            value={remoteConfig.username}
                            onChange={(event) =>
                              setRemoteConfig((prev) => ({ ...prev, username: event.target.value }))
                            }
                          />
                        </label>
                        <label>
                          Password
                          <input
                            type="password"
                            value={remoteConfig.password}
                            onChange={(event) =>
                              setRemoteConfig((prev) => ({ ...prev, password: event.target.value }))
                            }
                          />
                        </label>
                      </>
                    )}
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={useProxyRemote}
                        onChange={(event) => setUseProxyRemote(event.target.checked)}
                      />
                      Use proxy
                    </label>
                    {useProxyRemote && (
                      <>
                        <label>
                          Proxy target
                          <select
                            value={proxyTargetRemote}
                            onChange={(event) => setProxyTargetRemote(event.target.value)}
                          >
                            <option value="local">Local proxy URL</option>
                            <option value="remote">Remote proxy URL</option>
                          </select>
                        </label>
                        {proxyTargetRemote === "local" && (
                          <label>
                            Local proxy URL
                            <input
                              value={localProxyUrl}
                              onChange={(event) => setLocalProxyUrl(event.target.value)}
                              placeholder="http://localhost:3001"
                            />
                          </label>
                        )}
                        {proxyTargetRemote === "remote" && (
                          <label>
                            Remote proxy URL
                            <input
                              value={cloudProxyUrl}
                              onChange={(event) => setCloudProxyUrl(event.target.value)}
                              placeholder="https://your-proxy.example.com"
                            />
                          </label>
                        )}
                      </>
                    )}
                    <div className="muted">
                      Proxy avoids CORS blocks. Local uses proxy.mjs/proxy.py.
                    </div>
                  </div>
                )}

                <div className="button-row">
                  <button type="button" className="primary" onClick={connect} disabled={!canConnect}>
                    Connect
                  </button>
                </div>
                {connectionError && <p className="error">{connectionError}</p>}
                {proxyHint && <p className="error">{proxyHint}</p>}
              </>
            )}
          </section>

          <section className={`card pnl-card compact-card ${requiresConnectionClass}`.trim()}>
            <div className="card-title">PnL Tracker</div>
            <div className="pnl-table">
              <div className="pnl-row">
                <div className="pnl-label">Realized</div>
                <strong className={`pnl-value ${realizedTone}`}>
                  {latestRealized != null ? formatNumber(latestRealized, 2) : "—"}
                </strong>
                {realizedSeries.length ? (
                  <svg className={`pnl-sparkline ${realizedTone}`} viewBox="0 0 96 26" preserveAspectRatio="none">
                    <polyline points={realizedSparkline} />
                  </svg>
                ) : (
                  <div className="pnl-sparkline empty">—</div>
                )}
              </div>
              <div className="pnl-row">
                <div className="pnl-label">Unrealized</div>
                <strong className={`pnl-value ${unrealizedTone}`}>
                  {latestUnrealized != null ? formatNumber(latestUnrealized, 2) : "—"}
                </strong>
                {unrealizedSeries.length ? (
                  <svg className={`pnl-sparkline ${unrealizedTone}`} viewBox="0 0 96 26" preserveAspectRatio="none">
                    <polyline points={unrealizedSparkline} />
                  </svg>
                ) : (
                  <div className="pnl-sparkline empty">—</div>
                )}
              </div>
            </div>
          </section>

          <OpenOrdersCard
            requiresConnectionClass={requiresConnectionClass}
            orders={orders}
            handleCancel={handleCancel}
            getOrderStopLoss={getOrderStopLoss}
            getOrderTakeProfit={getOrderTakeProfit}
          />

          <OpenPositionsCard
            requiresConnectionClass={requiresConnectionClass}
            openPositionRows={openPositionRows}
            formatQty={formatQty}
            formatNumber={formatNumber}
          />

          <section className={`card compact-card ${requiresConnectionClass}`.trim()}>
            <div className="card-title">My Executions</div>
            {myExecs.length === 0 ? (
              <div className="muted">No executions yet.</div>
            ) : (
              <div className="executions-table">
                <div className="executions-row executions-row--head">
                  <span>Ticker</span>
                  <span>Side · Qty</span>
                  <span>Price</span>
                  <span>Tick</span>
                </div>
                <div className="executions-scroll">
                  {myExecs.map((fill) => {
                    const qty = Number(fill.quantity_filled ?? fill.quantity ?? fill.qty ?? 0);
                    const price = fill.vwap ?? fill.price;
                    return (
                      <div
                        key={fill.order_id ?? `${fill.ticker}-${fill.tick}-${price}`}
                        className="executions-row"
                      >
                        <strong>{fill.ticker}</strong>
                        <span>{fill.action} · {formatQty(qty)}</span>
                        <span>{formatNumber(price)}</span>
                        <span>{fill.tick ?? "—"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section className={`card ${requiresConnectionClass}`.trim()}>
            <div className="card-title">Demo Strategy</div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={demoStrategy.enabled}
                onChange={(event) =>
                  setDemoStrategy((prev) => ({ ...prev, enabled: event.target.checked }))
                }
              />
              Enable demo auto-trader
            </label>
            <div className="form-grid">
              <label>
                Quantity
                <input
                  type="number"
                  min="1"
                  value={demoStrategy.quantity}
                  onChange={(event) =>
                    setDemoStrategy((prev) => ({
                      ...prev,
                      quantity: Number(event.target.value) || 1,
                    }))
                  }
                />
              </label>
              <label>
                Interval (ms)
                <input
                  type="number"
                  min="500"
                  step="100"
                  value={demoStrategy.intervalMs}
                  onChange={(event) =>
                    setDemoStrategy((prev) => ({
                      ...prev,
                      intervalMs: Number(event.target.value) || 3000,
                    }))
                  }
                />
              </label>
              <label>
                Max position
                <input
                  type="number"
                  min="1"
                  value={demoStrategy.maxPos}
                  onChange={(event) =>
                    setDemoStrategy((prev) => ({
                      ...prev,
                      maxPos: Number(event.target.value) || 50,
                    }))
                  }
                />
              </label>
            </div>
            <div className="muted">
              Buys when last &lt; mid, sells when last &gt; mid. Uses market orders on the active ticker.
            </div>
          </section>

        </aside>

        <main className="main">
          <OrderbookSection
            requiresConnectionClass={requiresConnectionClass}
            isMergerArbCase={isMergerArbCase}
            bookView={bookView}
            setBookView={setBookView}
            orderbookDisplayOptions={ORDERBOOK_DISPLAY_OPTIONS}
            orderbookDisplayMode={orderbookDisplayMode}
            setOrderbookDisplayMode={setOrderbookDisplayMode}
            isGraphOnlyMode={isGraphOnlyMode}
            addBookPanel={addBookPanel}
            showOrderbookPanels={showOrderbookPanels}
            splitOrderbookLayout={splitOrderbookLayout}
            bookStates={bookStates}
            securities={securities}
            updateBookPanelTicker={updateBookPanelTicker}
            removeBookPanel={removeBookPanel}
            bookPanelPrimaryId={BOOK_PANEL_PRIMARY_ID}
            bookScrollRef={bookScrollRef}
            bookScrollRefs={bookScrollRefs}
            getVolumeTone={getVolumeTone}
            formatQty={formatQty}
            formatPriceSet={formatPriceSet}
            placeQuickOrder={placeQuickOrder}
            showCandlesPanel={showCandlesPanel}
            isMultiBook={isMultiBook}
            renderChartPanel={renderChartPanel}
          />
          
          <section className={`card terminal ${requiresConnectionClass}`.trim()}>
            <div className="terminal-header">
              <span>Privod Johnny Terminal</span>
            </div>
            <div className="terminal-actions terminal-actions--inline">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  if (terminalUnlocked) {
                    setTerminalUnlocked(false);
                    log("Terminal locked.", "system");
                  } else {
                    setShowTerminalPrompt(true);
                  }
                }}
              >
                {terminalUnlocked ? "Lock" : "Open Terminal"}
              </button>
              <button type="button" className="ghost small" onClick={enableAllLogFilters}>
                All Logs
              </button>
            </div>
            {terminalUnlocked && (
              <>
                <div className="terminal-filters">
                  {LOG_CATEGORIES.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      className={`terminal-filter ${
                        logFilters.includes(category.id) ? "active" : ""
                      }`}
                      onClick={() => toggleLogFilter(category.id)}
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
                <div className="terminal-body" ref={terminalBodyRef}>
                  {filteredTerminalLines.length ? (
                    filteredTerminalLines.map((line) => (
                      <div key={line.id} className={`terminal-line terminal-line--${line.category}`}>
                        <span className="terminal-stamp">{line.stamp}</span>
                        <span className={`terminal-tag terminal-tag--${line.category}`}>
                          {line.category}
                        </span>
                        <span className="terminal-message">{line.message}</span>
                      </div>
                    ))
                  ) : (
                    <div className="muted">No terminal activity yet.</div>
                  )}
                </div>
              </>
            )}
            <div className="terminal-metrics">
              <div className="terminal-metrics-title">Endpoint response time</div>
              {requestMetricRows.length ? (
                <>
                  <div className="terminal-metric-row terminal-metric-header">
                    <span>Endpoint</span>
                    <span>Avg (ms)</span>
                    <span>Last (ms)</span>
                    <span>Count</span>
                    <span>Status</span>
                  </div>
                  {requestMetricRows.map((row) => (
                    <div key={row.key} className="terminal-metric-row">
                      <span className="terminal-metric-endpoint">{row.key}</span>
                      <span className="terminal-metric-stat">{formatMs(row.avgMs)}</span>
                      <span className="terminal-metric-stat">{formatMs(row.lastMs)}</span>
                      <span className="terminal-metric-stat">{row.count}</span>
                      <span className="terminal-metric-stat">{row.lastStatus ?? "—"}</span>
                    </div>
                  ))}
                </>
              ) : (
                <div className="muted">No requests yet.</div>
              )}
            </div>
            {perfRows.length ? (
              <details className="terminal-perf" open>
                <summary>Fast polling performance</summary>
                <div className="terminal-perf-grid">
                  {perfRows.map((row) => {
                    const points = row.points;
                    const line = buildSparklinePoints(points);
                    const last = points[points.length - 1]?.ms ?? null;
                    return (
                      <div key={row.key} className="terminal-perf-card">
                        <div className="terminal-perf-header">
                          <strong>{row.label}</strong>
                          <span className="muted">{row.key}</span>
                        </div>
                        <div className="terminal-perf-meta">
                          <span>Last: {formatMs(last)}ms</span>
                          <span>
                            Poll:{" "}
                            {row.pollMs ? `${row.pollMs}ms` : "adaptive"}
                          </span>
                        </div>
                        <svg
                          className="terminal-sparkline"
                          viewBox="0 0 160 44"
                          preserveAspectRatio="none"
                        >
                          <polyline points={line} />
                        </svg>
                      </div>
                    );
                  })}
                </div>
              </details>
            ) : null}
          </section>
<ApiLab
            apiGet={apiGet}
            apiPost={apiPost}
            apiDelete={apiDelete}
            log={log}
            selectedTicker={selectedTicker}
            connected={Boolean(config)}
          />

          <section className={`card ${requiresConnectionClass}`.trim()} style={{ marginBottom: "20px" }}>
            <div className="card-title">Market Snapshot</div>
            <div className="snapshot-grid">
              <label>
                Active Ticker
                <select
                  value={selectedTicker}
                  onChange={(event) => setSelectedTicker(event.target.value)}
                >
                  {securities.map((sec) => (
                    <option key={sec.ticker} value={sec.ticker}>
                      {sec.ticker}
                    </option>
                  ))}
                </select>
              </label>
              <div className="metric">
                <span>Last</span>
                <strong>{formatNumber(lastPrice)}</strong>
              </div>
              <div className="metric">
                <span>Bid</span>
                <strong>{formatNumber(bidPrice)}</strong>
              </div>
              <div className="metric">
                <span>Ask</span>
                <strong>{formatNumber(askPrice)}</strong>
              </div>
            </div>
          </section>
        </main>
      </div>

      {showTerminalPrompt && (
        <div className="modal">
          <div className="modal-card">
            <h3>Enable Privod Johnny Terminal?</h3>
            <p>
              This will start streaming live logs and actions inside the terminal panel.
            </p>
            <div className="button-row">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setTerminalUnlocked(true);
                  setShowTerminalPrompt(false);
                  log("Terminal unlocked.", "system");
                }}
              >
                Start Terminal
              </button>
              <button type="button" className="ghost" onClick={() => setShowTerminalPrompt(false)}>
                Not yet
              </button>
            </div>
          </div>
        </div>
      )}

      {showShortcuts && (
        <div className="modal">
          <div className="modal-card shortcuts-card">
            <div className="shortcuts-header">
              <h3>Shortcuts</h3>
              <button type="button" className="ghost" onClick={() => setShowShortcuts(false)}>
                Close
              </button>
            </div>
            <div className="shortcuts-list">
              {shortcuts.map((item) => (
                <div key={item.keys} className="shortcuts-row">
                  <span className="shortcut-key">{item.keys}</span>
                  <span className="shortcut-action">{item.action}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showTutorial && (
        <div className="modal">
          <div className="modal-card tutorial-card">
            <div className="shortcuts-header">
              <h3>Welcome Tutorial</h3>
            </div>
            <div className="tutorial-block">
              <h4>Order Book Views</h4>
              <div className="muted">Book Trader shows trader + volume columns. Ladder Trader is the compact bid/ask ladder.</div>
            </div>
            <div className="tutorial-block">
              <h4>Mouse Trading</h4>
              <div className="muted">Left-click places a BUY order. Right-click places a SELL order.</div>
              <div className="muted">• Clicking in the bid zone (prices ≤ best bid) submits a limit BUY on left-click and a market SELL on right-click.</div>
              <div className="muted">• Clicking in the ask zone (prices ≥ best ask) submits a limit SELL on right-click and a market BUY on left-click.</div>
              <div className="muted">• Clicking inside the spread submits no order.</div>
            </div>
            <div className="tutorial-block">
              <h4>Chart Renderers</h4>
              <div className="muted">
                Try different chart renderers in Chart Settings; each engine has different interaction and visual behavior.
              </div>
            </div>
            <div className="tutorial-block">
              <h4>Shortcuts</h4>
              <div className="tutorial-shortcuts">
                {shortcuts.map((item) => (
                  <div key={`tutorial-${item.keys}`} className="shortcuts-row">
                    <span className="shortcut-key">{item.keys}</span>
                    <span className="shortcut-action">{item.action}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="button-row">
              <button type="button" className="primary" onClick={dismissTutorial}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {showUpdatePrompt && updatePayload && (
        <div className="modal">
          <div className="modal-card update-card">
            <h3>What’s New</h3>
            <p className="muted">Updated: {formatHumanDate(updatePayload.latest.timestamp)}</p>
            <div className="update-message">
              {updatePayload.latest.message ? (
                updatePayload.latest.message.split("\n").map((line, index) => (
                  <div key={`update-line-${index}`}>{line || "\u00A0"}</div>
                ))
              ) : (
                <div className="muted">No update details right now.</div>
              )}
              {updatePayload.updates.length > 1 && (
                <details className="update-history">
                  <summary>Previous updates</summary>
                  <div className="update-history-list">
                    {updatePayload.updates.slice(1).map((entry, index) => (
                      <div key={`${entry.timestamp}-${index}`} className="update-history-item">
                        <div className="muted">Updated: {formatHumanDate(entry.timestamp)}</div>
                        {entry.message ? (
                          entry.message.split("\n").map((line, lineIndex) => (
                            <div key={`update-old-${index}-${lineIndex}`}>{line || "\u00A0"}</div>
                          ))
                        ) : (
                          <div className="muted">No update details right now.</div>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
            <div className="button-row">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  try {
                    localStorage.setItem(UPDATE_SEEN_KEY, updatePayload.latest.timestamp);
                  } catch {
                    // Storage can be fussy; the update still got the spotlight.
                  }
                  setShowUpdatePrompt(false);
                }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {indicatorInfo && (
        <div className="modal">
          <div className="modal-card indicator-card">
            <h3>{indicatorInfo.label}</h3>
            <p className="muted">{indicatorInfo.description}</p>
            <div className="button-row">
              <button type="button" className="primary" onClick={() => setIndicatorInfo(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
