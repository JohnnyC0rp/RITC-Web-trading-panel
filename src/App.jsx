import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import ApiLab from "./components/ApiLab";
import "./App.css";

const DEFAULT_LOCAL = {
  baseUrl: "http://localhost:9999",
  apiKey: "",
};

const DEFAULT_REMOTE = {
  baseUrl: "http://flserver.rotman.utoronto.ca:16530",
  authHeader: "",
};

const POLL_CASE_MS = 333;
const POLL_BOOK_MS = 333;
const POLL_SECURITIES_MS = 2500;
const POLL_ORDERS_MS = 2500;
const POLL_TRADER_MS = 1000;
const POLL_TAS_MS = 1000;
const POLL_FILLS_MS = 1000;
const CANDLE_BUCKET = 5;

const normalizeBaseUrl = (url) =>
  url.replace(/\/+$/, "").replace(/\/v1$/i, "").replace(/\/v1\/$/i, "");

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

const getVolumeTone = (ratio) => {
  if (ratio >= 0.6) return "deep";
  if (ratio >= 0.3) return "mid";
  if (ratio > 0) return "light";
  return "none";
};

function App() {
  const [mode, setMode] = useState("local");
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
  const [lastBookInteraction, setLastBookInteraction] = useState(0);
  const [lastBookUpdateAt, setLastBookUpdateAt] = useState(0);
  const [lastConnectAt, setLastConnectAt] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [newsItems, setNewsItems] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [tenderPrices, setTenderPrices] = useState({});
  const bookScrollRef = useRef(null);
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
  const [cloudProxyUrl, setCloudProxyUrl] = useState(
    "https://privod-johnny-ritc-api-cors-proxy.matveyrotte.workers.dev"
  );
  const [chartView, setChartView] = useState({});
  const [showChartSettings, setShowChartSettings] = useState(false);
  const [showRangeSlider, setShowRangeSlider] = useState(false);
  const [showMa20, setShowMa20] = useState(true);
  const [showMa50, setShowMa50] = useState(false);

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
    const url = buildUrl(cfg.baseUrl, path, params);
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
    const remoteProxyBase =
      proxyTargetRemote === "remote" && cloudProxyUrl.trim()
        ? cloudProxyUrl.trim()
        : "http://localhost:3001";
    const cfg =
      mode === "local"
        ? {
            baseUrl: useProxy ? "http://localhost:3001" : localConfig.baseUrl,
            headers: {
              "X-API-Key": localConfig.apiKey,
              ...(useProxy ? { "X-Proxy-Target": "local" } : {}),
            },
          }
        : {
            baseUrl: useProxy ? remoteProxyBase : remoteConfig.baseUrl,
            headers: {
              Authorization: remoteConfig.authHeader,
              ...(useProxy ? { "X-Proxy-Target": "remote" } : {}),
            },
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
    localConfig,
    mode,
    remoteConfig,
    requestWithConfig,
    log,
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
    const id = setInterval(pull, POLL_CASE_MS);
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
    const id = setInterval(pull, POLL_TAS_MS);
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
    const id = setInterval(pull, POLL_FILLS_MS);
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
    const id = setInterval(pull, POLL_TRADER_MS);
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
    const id = setInterval(pull, POLL_SECURITIES_MS);
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
    const id = setInterval(pull, 3000);
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

    const pull = async () => {
      try {
        const bookData = await apiGet("/securities/book", {
          ticker: selectedTicker,
          limit: 10,
        });
        if (!stop) {
          setBook(bookData || null);
          setLastBookUpdateAt(Date.now());
          if (hadStaleRef.current) {
            setChartView({});
            hadStaleRef.current = false;
          }
        }
      } catch (error) {
        if (!stop && error?.status !== 429) {
          log(`Book error: ${error.message}`);
          maybeSuggestProxy(error);
        }
      }
    };

    pull();
    const id = setInterval(pull, POLL_BOOK_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [apiGet, config, log, selectedTicker]);

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
    const id = setInterval(pull, 4000);
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
    if (!config || !selectedTicker) return undefined;
    let stop = false;

    const pull = async () => {
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
      }
    };

    pull();
    const id = setInterval(pull, POLL_ORDERS_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [apiGet, config, log, selectedTicker]);

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
      updateBookWithOrder(orderDraft.side, price, quantity);
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
      updateBookWithOrder(side, roundedPrice, quantity);
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

  const updateBookWithOrder = (side, price, quantity) => {
    setBook((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      const levelsKey = side === "BUY" ? "bids" : "asks";
      const rawLevels = Array.isArray(prev[levelsKey]) ? [...prev[levelsKey]] : [];
      const idx = rawLevels.findIndex((lvl) => Number(lvl.price) === Number(price));
      if (idx >= 0) {
        const current = rawLevels[idx];
        const currentQty = getQty(current) ?? 0;
        rawLevels[idx] = {
          ...current,
          qty: currentQty + quantity,
          quantity: currentQty + quantity,
          size: currentQty + quantity,
        };
      } else {
        rawLevels.push({ price, qty: quantity });
      }
      rawLevels.sort((a, b) =>
        side === "BUY" ? Number(b.price) - Number(a.price) : Number(a.price) - Number(b.price)
      );
      next[levelsKey] = rawLevels;
      return next;
    });
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

  const markBookInteraction = () => {
    setLastBookInteraction(Date.now());
  };

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
    if (!priceRows.length || lastBookInteraction) return;
    centerOrderBook();
    setLastBookInteraction(Date.now());
  }, [centerOrderBook, lastBookInteraction, priceRows.length]);

  useEffect(() => {
    if (!priceRows.length) return;
    const interval = setInterval(() => {
      if (Date.now() - lastBookInteraction > 5000) {
        centerOrderBook();
        setLastBookInteraction(Date.now());
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [centerOrderBook, lastBookInteraction, priceRows.length]);

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

  const sma = useMemo(() => {
    if (!candles.length) return { ma20: [], ma50: [] };
    const closes = candles.map((c) => c.close);
    const ticks = candles.map((c) => c.tick);
    const calc = (window) => {
      const values = [];
      for (let i = 0; i < closes.length; i += 1) {
        if (i + 1 < window) {
          values.push(null);
          continue;
        }
        const slice = closes.slice(i + 1 - window, i + 1);
        const avg = slice.reduce((sum, val) => sum + val, 0) / window;
        values.push(Number(avg.toFixed(4)));
      }
      return { x: ticks, y: values };
    };
    return { ma20: calc(20), ma50: calc(50) };
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
        ...(showMa20
          ? [
              {
                type: "scatter",
                mode: "lines",
                name: "SMA 20",
                x: sma.ma20.x,
                y: sma.ma20.y,
                line: { color: "#1f77b4", width: 2 },
              },
            ]
          : []),
        ...(showMa50
          ? [
              {
                type: "scatter",
                mode: "lines",
                name: "SMA 50",
                x: sma.ma50.x,
                y: sma.ma50.y,
                line: { color: "#9467bd", width: 2 },
              },
            ]
          : []),
      ]
    : [];

  const chartLayout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "#F6F2EA",
    margin: { l: 40, r: 20, t: 30, b: 30 },
    dragmode: "zoom",
    xaxis: {
      title: "Tick",
      gridcolor: "rgba(0,0,0,0.08)",
      tickfont: { size: 10 },
      rangeslider: { visible: showRangeSlider },
    },
    yaxis: {
      title: "Price",
      gridcolor: "rgba(0,0,0,0.08)",
      tickfont: { size: 10 },
    },
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
    plot_bgcolor: "#F6F2EA",
    margin: { l: 40, r: 16, t: 14, b: 28 },
    height: 230,
    xaxis: { showgrid: false, tickfont: { size: 9 } },
    yaxis: { tickfont: { size: 10 }, zeroline: true },
  };

  const latestPnl = pnlSeries.length ? pnlSeries[pnlSeries.length - 1]?.pnl : null;
  const latestNlv = traderInfo?.nlv ?? (pnlSeries.length ? pnlSeries[pnlSeries.length - 1]?.nlv : null);
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

  const canConnect = mode === "local" ? localConfig.apiKey : remoteConfig.authHeader;
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
    <div className="app" onContextMenu={(event) => event.preventDefault()}>
      <div className="toast-stack" aria-live="polite">
        {tenders.map((tender) => (
          <div key={tender.tender_id} className="toast tender">
            <div className="tender-main">
              <div className="tender-title">
                {tender.caption || `Tender ${tender.tender_id}`}
              </div>
              <div className="tender-sub">
                {tender.action} {tender.quantity} @ {tender.price ?? "MKT"} • {tender.ticker}
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
            <img className="hero-logo" src="/logo-transparent.png" alt="Privod Johnny logo" />
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
                Local
              </button>
              <button
                type="button"
                className={mode === "remote" ? "active" : ""}
                onClick={() => setMode("remote")}
              >
                Remote
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
                  Use proxy (http://localhost:3001)
                </label>
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
                  ⚠️ Double-check the DMA port for your case (example: 16530). If Use proxy is
                  enabled, the proxy may still route to the port in <code>creds/rit_rest.json</code>.
                </div>
                <label>
                  Authorization
                  <input
                    value={remoteConfig.authHeader}
                    onChange={(event) =>
                      setRemoteConfig((prev) => ({ ...prev, authHeader: event.target.value }))
                    }
                    placeholder="Basic XXXXXXXXXX"
                  />
                </label>
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
                        <option value="local">Local (http://localhost:3001)</option>
                        <option value="remote">Remote proxy URL</option>
                      </select>
                    </label>
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
                <div
                  className="book-scroll"
                  ref={bookScrollRef}
                  onScroll={markBookInteraction}
                  onWheel={markBookInteraction}
                  onMouseDown={markBookInteraction}
                  onTouchStart={markBookInteraction}
                >
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
                        onClick={() => {
                          markBookInteraction();
                          placeQuickOrder(side, row.price);
                        }}
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
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={showMa20}
                      onChange={(event) => setShowMa20(event.target.checked)}
                    />
                    SMA 20
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={showMa50}
                      onChange={(event) => setShowMa50(event.target.checked)}
                    />
                    SMA 50
                  </label>
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
    </div>
  );
}

export default App;
