import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import ApiLab from "./components/ApiLab";
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
const UPDATE_SEEN_KEY = "privodJohnnyLastUpdateSeen";
const UPDATE_SOURCE_PATH = `${import.meta.env.BASE_URL}versions.txt`;
const UPDATE_SEPARATOR = "==================";

const POLL_INTERVALS_MS = {
  case: 333,
  book: 0,
  securities: 2500,
  orders: 333,
  trader: 1000,
  tas: 100,
  fills: 1000,
  tenders: 500,
  news: 500,
};
const BOOK_DEPTH_LIMIT = 1000;
const BOOK_POLL_MAX_MS = 1000;
const BOOK_POLL_BACKOFF_MS = 200;
const CANDLE_BUCKET = 5;

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

const loadUiPrefs = () => {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const saveUiPrefs = (payload) => {
  try {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(payload));
  } catch {
    // UI prefs are shy sometimes; we let them hide. 🙂
  }
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
  } catch (error) {
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

const formatLevel = (level) => ({
  price: level?.price ?? null,
  qty: getQty(level),
});

const sortDepth = (levels, limit) => (Array.isArray(levels) ? levels.slice(0, limit) : []);

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
    const endTick = startTick + bucketSize - 1;
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
  const [book, setBook] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const [orders, setOrders] = useState([]);
  const [traderInfo, setTraderInfo] = useState(null);
  const [pnlSeries, setPnlSeries] = useState([]);
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
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [updatePayload, setUpdatePayload] = useState(null);
  const [lastBookUpdateAt, setLastBookUpdateAt] = useState(0);
  const [lastConnectAt, setLastConnectAt] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [newsItems, setNewsItems] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [tenderPrices, setTenderPrices] = useState({});
  const bookScrollRef = useRef(null);
  const bookCenterRef = useRef({ connectAt: null, caseKey: null, tick2Period: null });
  const openOrdersRef = useRef([]);
  const cancelledOrdersRef = useRef(new Map());
  const lastCaseRef = useRef({ tick: null, period: null });
  const tickAlertRef = useRef({ period: null, fired: new Set() });
  const pnlBaseRef = useRef(null);
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
  const [showChartSettings, setShowChartSettings] = useState(false);
  const [showRangeSlider, setShowRangeSlider] = useState(false);
  const [indicatorState, setIndicatorState] = useState(INDICATOR_DEFAULTS);
  const [indicatorInfo, setIndicatorInfo] = useState(null);
  const [theme, setTheme] = useState("light");

  const [orderDraft, setOrderDraft] = useState({
    ticker: "",
    side: "BUY",
    quantity: "100",
    price: "",
  });

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
        if (!updates.length || !alive) return;
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
  }, []);

  useEffect(() => {
    const stored = loadUiPrefs();
    if (stored) {
      if (stored.theme) setTheme(stored.theme);
      if (typeof stored.showRangeSlider === "boolean") setShowRangeSlider(stored.showRangeSlider);
      if (typeof stored.showChartSettings === "boolean") setShowChartSettings(stored.showChartSettings);
      if (stored.indicators) {
        setIndicatorState((prev) => ({
          ...prev,
          ...stored.indicators,
        }));
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
      showRangeSlider,
      showChartSettings,
      indicators: indicatorState,
    });
  }, [indicatorState, showChartSettings, showRangeSlider, theme, uiPrefsHydrated]);

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

  const log = useCallback((message) => {
    const stamp = formatStamp(new Date());
    setTerminalLines((prev) => {
      const next = [...prev, `[${stamp}] ${message}`];
      return next.slice(-200);
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
    } catch (error) {
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

  const requestWithConfig = useCallback(async (cfg, path, params, options = {}) => {
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
    try {
      const res = await fetch(url, { ...options, headers });
      const text = await res.text();
      const data = safeJson(text);
      if (!res.ok) {
        const error = new Error(`HTTP ${res.status}`);
        error.status = res.status;
        error.data = data;
        throw error;
      }
      return data;
    } catch (error) {
      const networkError = error instanceof TypeError && String(error.message).includes("fetch");
      if (networkError) {
        const wrapped = new Error("Network error (possible CORS block)");
        wrapped.isNetworkError = true;
        throw wrapped;
      }
      throw error;
    }
  }, []);

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
      log(`Connected to ${cfg.baseUrl}`);
      log(`Case: ${caseData?.name ?? "Unknown"}`);
    } catch (error) {
      setActiveConfig(null);
      setConnectionStatus("Disconnected");
      const errMessage = error?.data?.message || error?.message || "Connection failed";
      setConnectionError(errMessage);
      if (error?.isNetworkError && !useProxy) {
        setProxyHint("Browser blocked this request (likely CORS). Run the local proxy and enable Use Proxy.");
      }
      log(`Connection error: ${error?.message || "Unknown"}`);
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
    setBook(null);
    setHistory([]);
    setOrders([]);
    setTraderInfo(null);
    setPnlSeries([]);
    setRealizedSeries([]);
    setUnrealizedSeries([]);
    setFills([]);
    setTasTrades([]);
    pnlBaseRef.current = null;
    tasAfterRef.current = null;
    setLastConnectAt(0);
    setLastBookUpdateAt(0);
    lastCaseRef.current = { tick: null, period: null };
    bookCenterRef.current = { connectAt: null, caseKey: null, tick2Period: null };
    log("Disconnected");
  };

  useEffect(() => {
    if (!config) return undefined;
    let stop = false;

    const pull = async () => {
      try {
        const data = await apiGet("/case");
        if (!stop) setCaseInfo(data || null);
      } catch (error) {
        if (!stop && error?.status !== 429) {
          log(`Case error: ${error.message}`);
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
          log(`TAS error: ${error.message}`);
          maybeSuggestProxy(error);
        }
      }
    };

    pull();
    const id = setInterval(pull, POLL_INTERVALS_MS.tas);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [apiGet, config, log, maybeSuggestProxy, selectedTicker]);

  useEffect(() => {
    if (!config) return undefined;
    let stop = false;

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
          log(`Fills error: ${error.message}`);
          maybeSuggestProxy(error);
        }
      }
    };

    pull();
    const id = setInterval(pull, POLL_INTERVALS_MS.fills);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [apiGet, config, log, maybeSuggestProxy]);

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
    setRealizedSeries((prev) => [...prev, { ts: stamp, value: realized }].slice(-600));
    setUnrealizedSeries((prev) => [...prev, { ts: stamp, value: unrealized }].slice(-600));
  }, [connectionStatus, fills, securities]);

  useEffect(() => {
    if (!config) return undefined;
    let stop = false;

    const pull = async () => {
      try {
        const data = await apiGet("/trader");
        if (stop) return;
        setTraderInfo(data || null);
        const nlv = Number(data?.nlv);
        if (!Number.isFinite(nlv)) return;
        if (pnlBaseRef.current === null) {
          pnlBaseRef.current = nlv;
        }
        const pnl = nlv - (pnlBaseRef.current ?? nlv);
        setPnlSeries((prev) => {
          const next = [...prev, { ts: Date.now(), nlv, pnl }];
          return next.slice(-600);
        });
      } catch (error) {
        if (!stop && error?.status !== 429) {
          log(`Trader error: ${error.message}`);
          maybeSuggestProxy(error);
        }
      }
    };

    pull();
    const id = setInterval(pull, POLL_INTERVALS_MS.trader);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [apiGet, config, log, maybeSuggestProxy]);

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
        log(`Demo strategy: ${side} ${demoStrategy.quantity} ${selectedTicker} @ MKT`);
      } catch (error) {
        log(`Demo strategy error: ${error?.data?.message || error.message}`);
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
      setPnlSeries([]);
      setRealizedSeries([]);
      setUnrealizedSeries([]);
      pnlBaseRef.current = null;
      setFills([]);
      setTasTrades([]);
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

    const pull = async () => {
      try {
        const list = await apiGet("/securities");
        if (!stop) setSecurities(list || []);
      } catch (error) {
        if (!stop) {
          log(`Securities error: ${error.message}`);
          maybeSuggestProxy(error);
        }
      }
    };

    pull();
    const id = setInterval(pull, POLL_INTERVALS_MS.securities);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [apiGet, config, log]);

  useEffect(() => {
    if (!config) return undefined;
    let stop = false;

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
          log(`Tenders error: ${error.message}`);
        }
      }
    };

    pull();
    const id = setInterval(pull, POLL_INTERVALS_MS.tenders);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [apiGet, config, log, playSound]);

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
    if (!config || !selectedTicker) return undefined;
    let stop = false;
    let inFlight = false;
    let timeoutId = null;
    let delayMs = POLL_INTERVALS_MS.book;

    const pullBook = async () => {
      if (stop || inFlight) return;
      inFlight = true;
      try {
        const bookData = await apiGet("/securities/book", {
          ticker: selectedTicker,
          limit: BOOK_DEPTH_LIMIT,
        });
        if (!stop) {
          setBook(bookData || null);
          setLastBookUpdateAt(Date.now());
          if (hadStaleRef.current) {
            setChartView({});
            hadStaleRef.current = false;
          }
        }
        delayMs = POLL_INTERVALS_MS.book;
      } catch (error) {
        if (!stop && error?.status !== 429) {
          log(`Book error: ${error.message}`);
          maybeSuggestProxy(error);
        }
        if (error?.status === 429) {
          delayMs = Math.min(
            BOOK_POLL_MAX_MS,
            Math.max(BOOK_POLL_BACKOFF_MS, delayMs * 2 || BOOK_POLL_BACKOFF_MS)
          );
        } else {
          delayMs = Math.min(BOOK_POLL_MAX_MS, Math.max(BOOK_POLL_BACKOFF_MS, delayMs || BOOK_POLL_BACKOFF_MS));
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
  }, [apiGet, config, log, maybeSuggestProxy, selectedTicker]);

  useEffect(() => {
    if (!config) return undefined;
    let stop = false;
    let inFlight = false;
    let timeoutId = null;

    const pullOrders = async () => {
      if (stop || inFlight) return;
      inFlight = true;
      try {
        const orderData = await apiGet("/orders", { status: "OPEN" });
        if (!stop) {
          const nextOrders = orderData || [];
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
                const qty = order.quantity ?? order.qty ?? "";
                notify(`Order filled: ${order.ticker} ${qty} @ ${order.price}`, "success");
              }
              cancelledOrdersRef.current.delete(orderId);
            }
          });
          openOrdersRef.current = nextOrders;
          setOrders(nextOrders);
        }
      } catch (error) {
        if (!stop && error?.status !== 429) {
          log(`Orders error: ${error.message}`);
          maybeSuggestProxy(error);
        }
      } finally {
        inFlight = false;
        if (!stop) {
          timeoutId = setTimeout(pullOrders, POLL_INTERVALS_MS.orders);
        }
      }
    };

    pullOrders();
    return () => {
      stop = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [apiGet, config, log, maybeSuggestProxy, notify]);

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
        if (!stop) {
          let didPing = false;
          setNewsItems((prev) => {
            const map = new Map(prev.map((entry) => [entry.id, entry]));
            normalized.forEach((entry) => {
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
            const cutoff = Date.now() - 30000;
            return merged.filter((item) => (item.receivedAt ?? 0) >= cutoff).slice(-60);
          });
          if (didPing) {
            playSound("news");
          }
          const maxKey = Math.max(
            ...normalized.map((entry) => (Number.isFinite(entry.sortKey) ? entry.sortKey : -1))
          );
          if (Number.isFinite(maxKey) && maxKey >= 0) {
            newsSinceRef.current = maxKey;
          }
        }
      } catch (error) {
        if (!stop && error?.status !== 429) {
          log(`News error: ${error.message}`);
        }
      }
    };

    pull();
    const id = setInterval(pull, POLL_INTERVALS_MS.news);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [apiGet, config, log]);

  useEffect(() => {
    const id = setInterval(() => {
      setNewsItems((prev) => prev.filter((item) => Date.now() - (item.receivedAt ?? 0) < 30000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!config || !selectedTicker || caseInfo?.tick == null) return;
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
          log(`History error: ${error.message}`);
          maybeSuggestProxy(error);
        }
      }
    };
    pull();
    return () => {
      stop = true;
    };
  }, [apiGet, caseInfo?.tick, caseInfo?.ticks_per_period, config, historyEpoch, log, selectedTicker]);

  const handleOrderSubmit = async (event) => {
    event.preventDefault();
    if (!config) return;

    const quantity = parseInt(orderDraft.quantity, 10);
    const price = parseFloat(orderDraft.price);
    if (!orderDraft.ticker || !quantity || !price) {
      log("Order entry missing fields.");
      return;
    }

    try {
      const payload = {
        ticker: orderDraft.ticker,
        type: "LIMIT",
        quantity,
        action: orderDraft.side,
        price,
      };
      const result = await apiPost("/orders", payload);
      log(`Order sent: ${orderDraft.side} ${quantity} ${orderDraft.ticker} @ ${price}`);
      log(`Order response: ${JSON.stringify(result)}`);
      notify(`Order placed: ${orderDraft.side} ${quantity} ${orderDraft.ticker} @ ${price}`, "info");
    } catch (error) {
      log(`Order error: ${error?.data?.message || error.message}`);
    }
  };

  const handleCancel = async (orderId) => {
    if (!config) return;
    try {
      cancelledOrdersRef.current.set(orderId, Date.now());
      await apiDelete(`/orders/${orderId}`);
      log(`Order ${orderId} cancelled.`);
    } catch (error) {
      log(`Cancel error: ${error?.data?.message || error.message}`);
    }
  };

  const placeQuickOrder = async (side, price) => {
    if (!config || !selectedTicker) return;
    const quantity = parseInt(orderDraft.quantity, 10) || 1;
    const roundedPrice = Number(price);
    try {
      const payload = {
        ticker: selectedTicker,
        type: "LIMIT",
        quantity,
        action: side,
        price: roundedPrice,
      };
      await apiPost("/orders", payload);
      log(`Quick order: ${side} ${quantity} ${selectedTicker} @ ${roundedPrice}`);
      notify(`Order placed: ${side} ${quantity} ${selectedTicker} @ ${roundedPrice}`, "info");
    } catch (error) {
      log(`Quick order error: ${error?.data?.message || error.message}`);
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
      log(`Tender accept error: ${error?.data?.message || error.message}`);
    }
  };

  const declineTender = async (tenderId) => {
    if (!config) return;
    try {
      await apiDelete(`/tenders/${tenderId}`);
      notify(`Tender declined: ${tenderId}`, "info");
      setTenders((prev) => prev.filter((item) => item.tender_id !== tenderId));
    } catch (error) {
      log(`Tender decline error: ${error?.data?.message || error.message}`);
    }
  };

  const lastPrice = securities.find((sec) => sec.ticker === selectedTicker)?.last ?? null;
  const bidPrice = securities.find((sec) => sec.ticker === selectedTicker)?.bid ?? null;
  const askPrice = securities.find((sec) => sec.ticker === selectedTicker)?.ask ?? null;

  const activeSecurity = securities.find((sec) => sec.ticker === selectedTicker) || {};
  const quotedDecimals = Number.isInteger(activeSecurity.quoted_decimals)
    ? activeSecurity.quoted_decimals
    : 2;
  const priceStep = getStepFromDecimals(quotedDecimals);

  const aggregateLevels = (levels) => {
    const map = new Map();
    (levels || []).forEach((level) => {
      if (level?.price === undefined || level?.price === null) return;
      const qty = getQty(level) ?? 0;
      const key = Number(level.price).toFixed(quotedDecimals);
      map.set(key, (map.get(key) || 0) + qty);
    });
    return map;
  };

  const bidLevels = book?.bids || book?.bid || [];
  const askLevels = book?.asks || book?.ask || [];
  const bidMap = aggregateLevels(bidLevels);
  const askMap = aggregateLevels(askLevels);
  const maxVolume = Math.max(
    1,
    ...Array.from(bidMap.values()),
    ...Array.from(askMap.values())
  );

  const bestBidPrice = bidLevels[0]?.price ?? bidPrice ?? lastPrice;
  const bestAskPrice = askLevels[0]?.price ?? askPrice ?? lastPrice;
  const midPrice =
    bestBidPrice && bestAskPrice
      ? (Number(bestBidPrice) + Number(bestAskPrice)) / 2
      : Number(bestBidPrice || bestAskPrice || lastPrice || 0);

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

  const rowCount = 80;
  const halfRows = Math.floor(rowCount / 2);
  const midTick = toStepTick(midPrice, priceStep);
  const hasSpread =
    Number.isFinite(bestBidPrice) &&
    Number.isFinite(bestAskPrice) &&
    Number(bestAskPrice) - Number(bestBidPrice) > priceStep;
  const spreadCenterTick = hasSpread
    ? toStepTick((Number(bestBidPrice) + Number(bestAskPrice)) / 2, priceStep)
    : midTick;
  const priceRows = Array.from({ length: rowCount }, (_, idx) => {
    const offset = halfRows - idx;
    const tick = midTick + offset;
    const price = fromStepTick(tick, priceStep, quotedDecimals);
    const key = price.toFixed(quotedDecimals);
    const isSpread =
      hasSpread && price > Number(bestBidPrice) && price < Number(bestAskPrice);
    return {
      price,
      bidQty: bidMap.get(key) || 0,
      askQty: askMap.get(key) || 0,
      isMid: hasSpread && tick === midTick,
      isSpread,
      isCenter: tick === spreadCenterTick,
      key,
    };
  });

  const ordersByPrice = useMemo(() => {
    const map = new Map();
    orders.forEach((order) => {
      if (order?.ticker !== selectedTicker || order?.price == null) return;
      const key = Number(order.price).toFixed(quotedDecimals);
      const side = String(order.action || "").toUpperCase();
      const qty = Number(order.quantity ?? order.qty ?? 0);
      const entry = map.get(key) || { buyQty: 0, buyCount: 0, sellQty: 0, sellCount: 0 };
      if (side === "BUY") {
        entry.buyQty += qty;
        entry.buyCount += 1;
      } else if (side === "SELL") {
        entry.sellQty += qty;
        entry.sellCount += 1;
      }
      map.set(key, entry);
    });
    return map;
  }, [orders, quotedDecimals, selectedTicker]);

  const centerOrderBook = useCallback(() => {
    const container = bookScrollRef.current;
    if (!container) return;
    const target = container.querySelector('[data-center="true"]');
    if (!target) return;
    const targetTop = target.offsetTop;
    const targetHeight = target.offsetHeight || 0;
    const containerHeight = container.clientHeight || 0;
    const nextScrollTop = Math.max(0, targetTop - containerHeight / 2 + targetHeight / 2);
    container.scrollTo({ top: nextScrollTop, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (connectionStatus !== "Connected" || !priceRows.length) return;
    const caseKey = caseInfo?.name ?? caseInfo?.case_id ?? caseInfo?.case ?? null;
    const currTick = Number(caseInfo?.tick);
    const currPeriod = caseInfo?.period ?? null;
    const bookCenterState = bookCenterRef.current;

    if (lastConnectAt && bookCenterState.connectAt !== lastConnectAt) {
      centerOrderBook();
      bookCenterState.connectAt = lastConnectAt;
      if (caseKey) bookCenterState.caseKey = caseKey;
      if (currTick === 2) bookCenterState.tick2Period = currPeriod;
      return;
    }

    if (caseKey && bookCenterState.caseKey !== caseKey) {
      centerOrderBook();
      bookCenterState.caseKey = caseKey;
      if (currTick === 2) bookCenterState.tick2Period = currPeriod;
      return;
    }

    if (currTick === 2 && bookCenterState.tick2Period !== currPeriod) {
      // A single gentle nudge when tick 2 arrives. No scroll-wrestling, promise.
      centerOrderBook();
      bookCenterState.tick2Period = currPeriod;
    }
  }, [
    caseInfo?.case,
    caseInfo?.case_id,
    caseInfo?.name,
    caseInfo?.period,
    caseInfo?.tick,
    centerOrderBook,
    connectionStatus,
    lastConnectAt,
    priceRows.length,
  ]);

  // Order book scroll stays where the trader puts it. Autoscroll was cute, not useful.

  const candles = useMemo(() => aggregateCandles(history, 5), [history]);

  const candleData = useMemo(() => {
    if (!candles.length) return null;
    const ticks = candles.map((c) => c.tick);
    return {
      x: ticks,
      open: candles.map((c) => c.open),
      high: candles.map((c) => c.high),
      low: candles.map((c) => c.low),
      close: candles.map((c) => c.close),
    };
  }, [candles]);

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

  const dealTrace = useMemo(() => {
    if (!tasTrades.length) return null;
    return {
      type: "scatter",
      mode: "markers",
      name: "Deals",
      x: tasTrades.map((trade) => toBucketTick(Number(trade.tick))),
      y: tasTrades.map((trade) => trade.price),
      marker: { size: 6, color: "rgba(148, 163, 184, 0.55)" },
    };
  }, [tasTrades]);

  const fillMarkers = useMemo(() => {
    if (!fills.length || !selectedTicker) {
      return { opens: [], closes: [] };
    }
    const filtered = fills
      .filter(
        (fill) =>
          fill.ticker === selectedTicker &&
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
  }, [fills, selectedTicker]);

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

  const chartGridColor = theme === "dark" ? "rgba(148, 163, 184, 0.2)" : "rgba(0,0,0,0.08)";
  const chartTextColor = theme === "dark" ? "#e2e8f0" : "#0f172a";
  const chartPlotBg = theme === "dark" ? "#0f172a" : "#F6F2EA";

  const chartData = candleData
    ? [
        {
          type: "candlestick",
          x: candleData.x,
          open: candleData.open,
          high: candleData.high,
          low: candleData.low,
          close: candleData.close,
          increasing: { line: { color: "#2E8B57" } },
          decreasing: { line: { color: "#C0392B" } },
        },
        ...(dealTrace ? [dealTrace] : []),
        ...(fillMarkers.opens.length
          ? [
              {
                type: "scatter",
                mode: "markers",
                name: "Position Open",
                x: fillMarkers.opens.map((fill) => toBucketTick(Number(fill.tick))),
                y: fillMarkers.opens.map((fill) => fill.vwap ?? fill.price),
                marker: {
                  size: 11,
                  symbol: fillMarkers.opens.map((fill) =>
                    fill.action === "BUY" ? "triangle-up" : "triangle-down"
                  ),
                  color: fillMarkers.opens.map((fill) =>
                    fill.action === "BUY" ? "#22c55e" : "#ef4444"
                  ),
                  line: { width: 1.5, color: "rgba(15, 23, 42, 0.25)" },
                },
              },
            ]
          : []),
        ...(fillMarkers.closes.length
          ? [
              {
                type: "scatter",
                mode: "markers",
                name: "Position Close",
                x: fillMarkers.closes.map((fill) => toBucketTick(Number(fill.tick))),
                y: fillMarkers.closes.map((fill) => fill.vwap ?? fill.price),
                marker: {
                  size: 9,
                  symbol: fillMarkers.closes.map((fill) =>
                    fill.action === "BUY" ? "triangle-up" : "triangle-down"
                  ),
                  color: fillMarkers.closes.map((fill) =>
                    fill.action === "BUY" ? "#22c55e" : "#ef4444"
                  ),
                  line: { width: 1.2, color: "rgba(15, 23, 42, 0.25)" },
                  opacity: 0.85,
                },
              },
            ]
          : []),
        ...indicatorTraces,
      ]
    : [];

  const chartLayout = {
    paper_bgcolor: "rgba(0,0,0,0)",
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
    },
    ...(showOscillatorAxis
      ? {
          yaxis2: {
            overlaying: "y",
            side: "right",
            showgrid: false,
            tickfont: { size: 9, color: chartTextColor },
          },
        }
      : {}),
    uirevision: selectedTicker,
    ...chartView,
  };

  const chartConfig = {
    displayModeBar: true,
    responsive: true,
    scrollZoom: true,
    doubleClick: "reset",
    modeBarButtonsToRemove: ["select2d", "lasso2d"],
  };

  const pnlData = useMemo(() => {
    if (!pnlSeries.length) return [];
    return [
      {
        type: "scatter",
        mode: "lines",
        name: "PnL",
        x: pnlSeries.map((entry) => new Date(entry.ts)),
        y: pnlSeries.map((entry) => entry.pnl),
        line: { color: "#0ea5e9", width: 2 },
      },
    ];
  }, [pnlSeries]);

  const pnlLayout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: chartPlotBg,
    margin: { l: 40, r: 16, t: 14, b: 28 },
    height: 230,
    font: { color: chartTextColor },
    xaxis: { showgrid: false, tickfont: { size: 9, color: chartTextColor } },
    yaxis: { tickfont: { size: 10, color: chartTextColor }, zeroline: true, gridcolor: chartGridColor },
  };

  const latestPnl = pnlSeries.length ? pnlSeries[pnlSeries.length - 1]?.pnl : null;
  const latestNlv = traderInfo?.nlv ?? (pnlSeries.length ? pnlSeries[pnlSeries.length - 1]?.nlv : null);

  const traderLabel = useMemo(() => {
    if (!traderInfo) return "—";
    const id = traderInfo.trader_id ? String(traderInfo.trader_id) : "";
    const name = [traderInfo.first_name, traderInfo.last_name].filter(Boolean).join(" ");
    return [id, name].filter(Boolean).join(" · ") || "—";
  }, [traderInfo]);

  const portfolioPositions = useMemo(() => {
    // Quick roster so you always know who’s on the field. 🏟️
    return securities
      .map((sec) => ({
        ticker: sec.ticker,
        position: Number(sec.position ?? sec.pos ?? 0),
      }))
      .filter((entry) => entry.ticker && entry.position !== 0)
      .sort((a, b) => {
        const diff = Math.abs(b.position) - Math.abs(a.position);
        if (diff !== 0) return diff;
        return String(a.ticker).localeCompare(String(b.ticker));
      });
  }, [securities]);
  const latestRealized = realizedSeries.length
    ? realizedSeries[realizedSeries.length - 1]?.value
    : null;
  const latestUnrealized = unrealizedSeries.length
    ? unrealizedSeries[unrealizedSeries.length - 1]?.value
    : null;
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

  const realizedData = useMemo(() => {
    if (!realizedSeries.length) return [];
    return [
      {
        type: "scatter",
        mode: "lines",
        name: "Realized",
        x: realizedSeries.map((entry) => new Date(entry.ts)),
        y: realizedSeries.map((entry) => entry.value),
        line: { color: "#22c55e", width: 2 },
      },
    ];
  }, [realizedSeries]);

  const unrealizedData = useMemo(() => {
    if (!unrealizedSeries.length) return [];
    return [
      {
        type: "scatter",
        mode: "lines",
        name: "Unrealized",
        x: unrealizedSeries.map((entry) => new Date(entry.ts)),
        y: unrealizedSeries.map((entry) => entry.value),
        line: { color: "#f97316", width: 2 },
      },
    ];
  }, [unrealizedSeries]);

  const canConnect =
    mode === "local"
      ? localConfig.apiKey
      : remoteConfig.authMode === "header"
        ? remoteConfig.authHeader
        : remoteConfig.username && remoteConfig.password;
  const isCaseStopped = connectionStatus === "Connected" && caseInfo?.status === "STOPPED";
  // Status copy tweak: show "idling" without sounding alarmist (yellow is enough drama). 😅
  const statusLabel = isCaseStopped ? "Connected, idling" : connectionStatus;
  const statusClass = isCaseStopped
    ? "warning"
    : connectionStatus === "Connected"
      ? "online"
      : "offline";
  const statusDetail = isCaseStopped
    ? "Connected, idling."
    : caseInfo?.name || "No case selected";
  const newsText = newsItems.length
    ? newsItems.map((item) => item.text).join(" • ")
    : Array.from({ length: 3 }, () => "News feed idle").join(" • ");
  const newsLoop = Array.from({ length: 6 }, () => newsText).join(" • ");
  const timeTicker = caseInfo
    ? `Tick ${caseInfo.tick ?? "—"} / ${caseInfo.ticks_per_period ?? "—"} • Period ${
        caseInfo.period ?? "—"
      } / ${caseInfo.total_periods ?? "—"}`
    : "";
  const ticksPerPeriod = caseInfo?.ticks_per_period ?? null;
  const currentTick = caseInfo?.tick ?? null;
  const ticksLeft =
    ticksPerPeriod != null && currentTick != null
      ? Math.max(Number(ticksPerPeriod) - Number(currentTick), 0)
      : null;
  const tickProgress =
    ticksPerPeriod && currentTick != null
      ? Math.min(Math.max(Number(currentTick) / Number(ticksPerPeriod), 0), 1)
      : 0;
  const tickHue = Number.isFinite(tickProgress) ? 120 * (1 - tickProgress) : 120;
  const tickColor = `hsl(${tickHue}, 70%, 45%)`;
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
      <div className="news-ticker">
        <div className="news-track">
          <span>{newsLoop}</span>
          <span aria-hidden="true">{newsLoop}</span>
        </div>
      </div>
      <header className="hero">
        <div>
          <p className="hero-eyebrow">RIT Trading Client</p>
          <div className="hero-title">
            <img className="hero-logo" src={logoUrl} alt="Privod Johnny logo" />
            <h1>Privod Johnny</h1>
          </div>
          <p className="hero-subtitle">A modern trading cockpit with live order book, candles, and fast order entry.</p>
        </div>
        <div className="status-block">
          <div className={`status-pill ${statusClass}`}>
            {statusLabel}
          </div>
          {routeSteps.length > 0 && (
            <div className="status-route status-route--inline">
              {routeSteps.map((step, index) => (
                <span key={`${step}-${index}`} className="status-route__step">
                  {step}
                </span>
              ))}
            </div>
          )}
          <span className="status-detail">{statusDetail}</span>
          {timeTicker && <span className="status-meta">{timeTicker}</span>}
          {ticksLeft !== null && (
            <>
              <div className="tick-bar" aria-label={`Ticks left: ${ticksLeft}`}>
                <div
                  className="tick-bar__fill"
                  style={{ width: `${Math.round(tickProgress * 100)}%`, background: tickColor }}
                />
              </div>
              <span className="status-meta">Ticks left: {ticksLeft}</span>
            </>
          )}
        </div>
        <div className="hero-actions">
          <button
            type="button"
            className="theme-toggle"
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
          <section className="card">
            <div className="card-title">Connection</div>
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
              <button type="button" className="ghost" onClick={disconnect}>
                Disconnect
              </button>
            </div>
            {connectionError && <p className="error">{connectionError}</p>}
            {proxyHint && <p className="error">{proxyHint}</p>}
          </section>

          <section className="card">
            <div className="card-title">Order Entry</div>
            <form onSubmit={handleOrderSubmit} className="form-grid">
              <label>
                Ticker
                <select
                  value={orderDraft.ticker}
                  onChange={(event) =>
                    setOrderDraft((prev) => ({ ...prev, ticker: event.target.value }))
                  }
                >
                  <option value="">Select</option>
                  {securities.map((sec) => (
                    <option key={sec.ticker} value={sec.ticker}>
                      {sec.ticker}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Side
                <select
                  value={orderDraft.side}
                  onChange={(event) =>
                    setOrderDraft((prev) => ({ ...prev, side: event.target.value }))
                  }
                >
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </label>
              <label>
                Quantity
                <input
                  type="number"
                  min="1"
                  value={orderDraft.quantity}
                  onChange={(event) =>
                    setOrderDraft((prev) => ({ ...prev, quantity: event.target.value }))
                  }
                />
              </label>
              <label>
                Limit Price
                <input
                  type="number"
                  step="0.01"
                  value={orderDraft.price}
                  onChange={(event) =>
                    setOrderDraft((prev) => ({ ...prev, price: event.target.value }))
                  }
                />
              </label>
              <button type="submit" className="primary full">
                Place Limit Order
              </button>
            </form>
          </section>

          <section className="card">
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

          <section className="card">
            <div className="card-title">Open Orders</div>
            <div className="orders-list">
              {orders.length === 0 && <div className="muted">No open orders yet.</div>}
              {orders.map((order) => {
                const orderId = order.order_id ?? order.id;
                return (
                  <div key={orderId} className="order-row">
                  <div>
                    <strong>{order.ticker}</strong>
                    <div className="muted">{order.action} {order.quantity} @ {order.price}</div>
                  </div>
                  <button type="button" className="ghost" onClick={() => handleCancel(orderId)}>
                    Cancel
                  </button>
                </div>
                );
              })}
            </div>
          </section>

          <section className="card">
            <div className="card-title">Open Positions</div>
            <div className="orders-list">
              {securities.filter((sec) => Number(sec.position ?? sec.pos ?? 0) !== 0).length ===
                0 && <div className="muted">No open positions.</div>}
              {securities
                .filter((sec) => Number(sec.position ?? sec.pos ?? 0) !== 0)
                .map((sec) => {
                  const position = Number(sec.position ?? sec.pos ?? 0);
                  return (
                    <div key={sec.ticker} className="order-row">
                      <div>
                        <strong>{sec.ticker}</strong>
                        <div className="muted">Position: {formatQty(position)}</div>
                      </div>
                      <div className="muted">
                        Last {formatNumber(sec.last)} · Bid {formatNumber(sec.bid)} · Ask{" "}
                        {formatNumber(sec.ask)}
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
        </aside>

        <main className="main">
          <section className="card" style={{ marginBottom: "20px" }}>
            <div className="card-title">Market Snapshot</div>
            <div className="snapshot-grid">
              <label>
                Active Ticker
                <select value={selectedTicker} onChange={(event) => setSelectedTicker(event.target.value)}>
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

          <section className="card" style={{ marginBottom: "20px" }}>
            <div className="card-title">PnL Tracker</div>
            <div className="portfolio-row">
              <div className="portfolio-meta">
                <div className="metric">
                  <span>Trader</span>
                  <strong>{traderLabel}</strong>
                </div>
                <div className="metric">
                  <span>Positions</span>
                  <strong>{portfolioPositions.length ? formatQty(portfolioPositions.length) : "—"}</strong>
                </div>
              </div>
              <div className="portfolio-pills">
                {portfolioPositions.length ? (
                  portfolioPositions.map((entry) => (
                    <span
                      key={entry.ticker}
                      className={`pill portfolio-pill ${
                        entry.position > 0 ? "portfolio-pill--long" : "portfolio-pill--short"
                      }`}
                    >
                      <strong>{entry.ticker}</strong> {entry.position > 0 ? "Long" : "Short"}{" "}
                      {formatQty(Math.abs(entry.position))}
                    </span>
                  ))
                ) : (
                  <div className="muted">Flat (no open positions).</div>
                )}
              </div>
            </div>
            <div className="pnl-grid">
              <div className="metric">
                <span>NLV</span>
                <strong>{latestNlv != null ? formatNumber(latestNlv, 2) : "—"}</strong>
              </div>
              <div className="metric">
                <span>PnL</span>
                <strong>{latestPnl != null ? formatNumber(latestPnl, 2) : "—"}</strong>
              </div>
              <div className="metric">
                <span>Realized</span>
                <strong>{latestRealized != null ? formatNumber(latestRealized, 2) : "—"}</strong>
              </div>
              <div className="metric">
                <span>Unrealized</span>
                <strong>{latestUnrealized != null ? formatNumber(latestUnrealized, 2) : "—"}</strong>
              </div>
            </div>
            <div className="pnl-charts">
              {unrealizedSeries.length === 0 ? (
                <div className="muted">No unrealized PnL yet.</div>
              ) : (
                <Plot
                  data={unrealizedData}
                  layout={{ ...pnlLayout, title: { text: "Unrealized", font: { size: 11 } } }}
                  config={{ displayModeBar: false }}
                  style={{ width: "100%" }}
                />
              )}
              {realizedSeries.length === 0 ? (
                <div className="muted">No realized PnL yet.</div>
              ) : (
                <Plot
                  data={realizedData}
                  layout={{ ...pnlLayout, title: { text: "Realized", font: { size: 11 } } }}
                  config={{ displayModeBar: false }}
                  style={{ width: "100%" }}
                />
              )}
            </div>
          </section>

          <section className="card split">
            <div className="split-panel">
              <div className="card-title">Order Book</div>
              <div className="book-table">
                <div className="book-head wide">
                  <span>Bid Qty</span>
                  <span>Price</span>
                  <span>Ask Qty</span>
                </div>
                {/* Manual scroll stays manual. No auto-centering hijinks. */}
                <div className="book-scroll" ref={bookScrollRef}>
                  {priceRows.map((row, index) => {
                    const bidRatio = row.bidQty / maxVolume;
                    const askRatio = row.askQty / maxVolume;
                    const bidTone = getVolumeTone(bidRatio);
                    const askTone = getVolumeTone(askRatio);
                    const myOrders = ordersByPrice.get(row.key) || {};
                    const side = row.price <= (bestBidPrice ?? midPrice) ? "BUY" : "SELL";
                    return (
                      <div
                        key={`${row.price}-${index}`}
                        className={`book-row wide ${row.isMid ? "mid" : ""} ${row.isSpread ? "spread" : ""}`}
                        data-center={row.isCenter ? "true" : undefined}
                        onClick={() => placeQuickOrder(side, row.price)}
                      >
                        <span
                          className="book-cell bid"
                        >
                          <span
                            className={`book-bar ${bidTone}`}
                            style={{ width: `${Math.round(bidRatio * 100)}%` }}
                          />
                          {myOrders.buyCount ? (
                            <span className="book-meta">
                              <span className="book-chip">{formatQty(myOrders.buyCount)}x</span>
                              <span className="book-chip">{formatQty(myOrders.buyQty)}</span>
                            </span>
                          ) : null}
                          <span className="book-value">{formatQty(row.bidQty)}</span>
                        </span>
                        <span className={`price ${row.isMid ? "mid" : ""}`}>
                          {row.price.toFixed(quotedDecimals)}
                        </span>
                        <span
                          className="book-cell ask"
                        >
                          <span
                            className={`book-bar ${askTone}`}
                            style={{ width: `${Math.round(askRatio * 100)}%` }}
                          />
                          {myOrders.sellCount ? (
                            <span className="book-meta">
                              <span className="book-chip">{formatQty(myOrders.sellCount)}x</span>
                              <span className="book-chip">{formatQty(myOrders.sellQty)}</span>
                            </span>
                          ) : null}
                          <span className="book-value">{formatQty(row.askQty)}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="split-panel">
              <div className="card-title chart-header">
                <span>Candles</span>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setShowChartSettings((prev) => !prev)}
                >
                  Chart Settings
                </button>
              </div>
              {showChartSettings && (
                <div className="chart-settings">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={showRangeSlider}
                      onChange={(event) => setShowRangeSlider(event.target.checked)}
                    />
                    Enable range slider
                  </label>
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
                </div>
              )}
              {candles.length === 0 ? (
                <div className="muted">No candle history yet.</div>
              ) : (
                <Plot
                  data={chartData}
                  layout={chartLayout}
                  config={chartConfig}
                  style={{ width: "100%", height: "420px" }}
                  onRelayout={(ev) => {
                    const next = {};
                    if (ev["xaxis.autorange"] || ev["yaxis.autorange"]) {
                      setChartView({});
                      return;
                    }
                    if (ev["xaxis.range[0]"] && ev["xaxis.range[1]"]) {
                      next.xaxis = {
                        ...(chartView.xaxis || {}),
                        range: [ev["xaxis.range[0]"], ev["xaxis.range[1]"]],
                      };
                    }
                    if (ev["yaxis.range[0]"] && ev["yaxis.range[1]"]) {
                      next.yaxis = {
                        ...(chartView.yaxis || {}),
                        range: [ev["yaxis.range[0]"], ev["yaxis.range[1]"]],
                      };
                    }
                    if (Object.keys(next).length) {
                      setChartView((prev) => ({
                        ...prev,
                        ...next,
                      }));
                    }
                  }}
                />
              )}
            </div>
          </section>

          <section className="card" style={{ marginTop: "20px" }}>
            <div className="card-title">My Executions</div>
            <div className="orders-list">
              {myExecs.length === 0 ? (
                <div className="muted">No executions yet.</div>
              ) : (
                myExecs.map((fill) => {
                  const qty = Number(fill.quantity_filled ?? fill.quantity ?? fill.qty ?? 0);
                  const price = fill.vwap ?? fill.price;
                  return (
                    <div key={fill.order_id ?? `${fill.ticker}-${fill.tick}-${price}`} className="order-row">
                      <div>
                        <strong>{fill.ticker}</strong>
                        <div className="muted">
                          {fill.action} · Qty {formatQty(qty)} · Tick {fill.tick}
                        </div>
                      </div>
                      <div className="muted">{formatNumber(price)}</div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="card terminal">
            <div className="terminal-header">
              <span>Privod Johnny Terminal</span>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  if (terminalUnlocked) {
                    setTerminalUnlocked(false);
                    log("Terminal locked.");
                  } else {
                    setShowTerminalPrompt(true);
                  }
                }}
              >
                {terminalUnlocked ? "Lock" : "Unlock"}
              </button>
            </div>
            <div className={`terminal-body ${terminalUnlocked ? "" : "blurred"}`}>
              {terminalUnlocked ? (
                terminalLines.length ? (
                  terminalLines.map((line, index) => <div key={index}>{line}</div>)
                ) : (
                  <div className="muted">No terminal activity yet.</div>
                )
              ) : (
                <div className="muted">Terminal locked. Unlock to start streaming logs.</div>
              )}
            </div>
            {!terminalUnlocked && (
              <div className="terminal-overlay">
                <button type="button" className="primary" onClick={() => setShowTerminalPrompt(true)}>
                  Open Terminal
                </button>
              </div>
            )}
          </section>

          <ApiLab
            apiGet={apiGet}
            apiPost={apiPost}
            apiDelete={apiDelete}
            log={log}
            selectedTicker={selectedTicker}
            securities={securities}
            connected={Boolean(config)}
          />
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
                  log("Terminal unlocked.");
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
