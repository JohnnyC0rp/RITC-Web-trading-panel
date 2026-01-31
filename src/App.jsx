import { useCallback, useEffect, useMemo, useState } from "react";
import Plot from "react-plotly.js";
import ApiLab from "./components/ApiLab";
import "./App.css";

const DEFAULT_LOCAL = {
  baseUrl: "http://localhost:9999",
  apiKey: "",
};

const DEFAULT_REMOTE = {
  baseUrl: "http://flserver.rotman.utoronto.ca:10001",
  authHeader: "",
};

const POLL_BOOK_MS = 800;
const POLL_SECURITIES_MS = 2500;
const POLL_ORDERS_MS = 2500;

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
  const [orders, setOrders] = useState([]);
  const [terminalUnlocked, setTerminalUnlocked] = useState(false);
  const [showTerminalPrompt, setShowTerminalPrompt] = useState(false);
  const [terminalLines, setTerminalLines] = useState([]);
  const [useProxyLocal, setUseProxyLocal] = useState(false);
  const [useProxyRemote, setUseProxyRemote] = useState(true);
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

  const config = useMemo(() => {
    if (!activeConfig) return null;
    return {
      ...activeConfig,
      baseUrl: normalizeBaseUrl(activeConfig.baseUrl),
    };
  }, [activeConfig]);

  const log = useCallback((message) => {
    const stamp = new Date().toLocaleTimeString();
    setTerminalLines((prev) => {
      const next = [...prev, `[${stamp}] ${message}`];
      return next.slice(-200);
    });
  }, []);

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
            baseUrl: useProxy ? "http://localhost:3001" : remoteConfig.baseUrl,
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
    log("Disconnected");
  };

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
        if (!stop) setBook(bookData || null);
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
    if (!config || !selectedTicker) return undefined;
    let stop = false;

    const pull = async () => {
      try {
        const orderData = await apiGet("/orders", { status: "OPEN" });
        if (!stop) setOrders(orderData || []);
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
    if (!config || !selectedTicker) return;
    let stop = false;
    const pull = async () => {
      try {
        const historyData = await apiGet("/securities/history", {
          ticker: selectedTicker,
          limit: 80,
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
  }, [apiGet, config, log, selectedTicker]);

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
    } catch (error) {
      log(`Order error: ${error?.data?.message || error.message}`);
    }
  };

  const handleCancel = async (orderId) => {
    if (!config) return;
    try {
      await apiDelete(`/orders/${orderId}`);
      log(`Order ${orderId} cancelled.`);
    } catch (error) {
      log(`Cancel error: ${error?.data?.message || error.message}`);
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

  const rowCount = 80;
  const halfRows = Math.floor(rowCount / 2);
  const midTick = toStepTick(midPrice, priceStep);
  const priceRows = Array.from({ length: rowCount }, (_, idx) => {
    const offset = halfRows - idx;
    const tick = midTick + offset;
    const price = fromStepTick(tick, priceStep, quotedDecimals);
    const key = price.toFixed(quotedDecimals);
    return {
      price,
      bidQty: bidMap.get(key) || 0,
      askQty: askMap.get(key) || 0,
      isMid: tick === midTick,
    };
  });

  const candleData = useMemo(() => {
    if (!history?.length) return null;
    const ticks = history.map((c) => c.tick);
    return {
      x: ticks,
      open: history.map((c) => c.open),
      high: history.map((c) => c.high),
      low: history.map((c) => c.low),
      close: history.map((c) => c.close),
    };
  }, [history]);

  const sma = useMemo(() => {
    if (!history?.length) return { ma20: [], ma50: [] };
    const closes = history.map((c) => c.close);
    const ticks = history.map((c) => c.tick);
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
  }, [history]);

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
    modeBarButtonsToAdd: ["select2d", "lasso2d"],
    modeBarButtonsToRemove: ["zoomIn2d", "zoomOut2d"],
  };

  const canConnect = mode === "local" ? localConfig.apiKey : remoteConfig.authHeader;

  return (
    <div className="app">
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
          <div className={`status-pill ${connectionStatus === "Connected" ? "online" : "offline"}`}>
            {connectionStatus}
          </div>
          <span className="status-detail">{caseInfo?.name || "No case selected"}</span>
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
                <label>
                  Authorization
                  <input
                    value={remoteConfig.authHeader}
                    onChange={(event) =>
                      setRemoteConfig((prev) => ({ ...prev, authHeader: event.target.value }))
                    }
                  />
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={useProxyRemote}
                    onChange={(event) => setUseProxyRemote(event.target.checked)}
                  />
                  Use proxy (http://localhost:3001)
                </label>
                <div className="muted">
                  Proxy avoids CORS blocks. Start proxy.py before connecting.
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

          <section className="card split">
            <div className="split-panel">
              <div className="card-title">Order Book</div>
              <div className="book-table">
                <div className="book-head wide">
                  <span>Price</span>
                  <span>Bid Qty</span>
                  <span>Ask Qty</span>
                </div>
                <div className="book-scroll">
                  {priceRows.map((row, index) => {
                    const bidRatio = row.bidQty / maxVolume;
                    const askRatio = row.askQty / maxVolume;
                    const bidTone = getVolumeTone(bidRatio);
                    const askTone = getVolumeTone(askRatio);
                    return (
                      <div
                        key={`${row.price}-${index}`}
                        className={`book-row wide ${row.isMid ? "mid" : ""}`}
                      >
                        <span className={`price ${row.isMid ? "mid" : ""}`}>
                          {row.price.toFixed(quotedDecimals)}
                        </span>
                        <span className="book-cell">
                          <span
                            className={`book-bar ${bidTone}`}
                            style={{ width: `${Math.round(bidRatio * 100)}%` }}
                          />
                          <span className="book-value">{row.bidQty || ""}</span>
                        </span>
                        <span className="book-cell">
                          <span
                            className={`book-bar ${askTone}`}
                            style={{ width: `${Math.round(askRatio * 100)}%` }}
                          />
                          <span className="book-value">{row.askQty || ""}</span>
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
              {history.length === 0 ? (
                <div className="muted">No candle history yet.</div>
              ) : (
                <Plot
                  data={chartData}
                  layout={chartLayout}
                  config={chartConfig}
                  style={{ width: "100%", height: "420px" }}
                  onRelayout={(ev) => {
                    const next = {};
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
