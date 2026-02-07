import { useState } from "react";

const JsonBlock = ({ data }) => {
  if (!data || (Array.isArray(data) && data.length === 0)) {
    return <div className="muted">No data loaded.</div>;
  }
  return <pre className="json-block">{JSON.stringify(data, null, 2)}</pre>;
};

const parseNumber = (value) => {
  if (value === "") return undefined;
  const num = Number(value);
  return Number.isNaN(num) ? undefined : num;
};

const buildLeaseParams = (form) => {
  const params = { ticker: form.ticker };
  if (form.from1) params.from1 = form.from1;
  if (form.quantity1) params.quantity1 = parseNumber(form.quantity1);
  if (form.from2) params.from2 = form.from2;
  if (form.quantity2) params.quantity2 = parseNumber(form.quantity2);
  if (form.from3) params.from3 = form.from3;
  if (form.quantity3) params.quantity3 = parseNumber(form.quantity3);
  return params;
};

export default function ApiLab({
  apiGet,
  apiPost,
  apiDelete,
  log,
  selectedTicker,
  connected,
}) {
  const [trader, setTrader] = useState(null);
  const [limits, setLimits] = useState([]);
  const [news, setNews] = useState([]);
  const [newsSince, setNewsSince] = useState("");
  const [newsLimit, setNewsLimit] = useState("20");
  const [assets, setAssets] = useState([]);
  const [assetHistory, setAssetHistory] = useState([]);
  const [assetHistoryTicker, setAssetHistoryTicker] = useState("");
  const [assetHistoryLimit, setAssetHistoryLimit] = useState("50");
  const [tas, setTas] = useState([]);
  const [tasAfter, setTasAfter] = useState("0");
  const [tasLimit, setTasLimit] = useState("50");
  const [orderDetailId, setOrderDetailId] = useState("");
  const [orderDetail, setOrderDetail] = useState(null);
  const [tenders, setTenders] = useState([]);
  const [tenderPrices, setTenderPrices] = useState({});
  const [leases, setLeases] = useState([]);
  const [leaseForm, setLeaseForm] = useState({
    ticker: "",
    from1: "",
    quantity1: "",
    from2: "",
    quantity2: "",
    from3: "",
    quantity3: "",
  });
  const [leaseDetailId, setLeaseDetailId] = useState("");
  const [leaseDetail, setLeaseDetail] = useState(null);
  const [leaseUseForm, setLeaseUseForm] = useState({
    from1: "",
    quantity1: "",
    from2: "",
    quantity2: "",
    from3: "",
    quantity3: "",
  });
  const [bulkMode, setBulkMode] = useState("all");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkResult, setBulkResult] = useState(null);

  const effectiveAssetHistoryTicker = assetHistoryTicker || selectedTicker || "";
  const effectiveLeaseTicker = leaseForm.ticker || selectedTicker || "";

  const handle = async (label, fn) => {
    try {
      await fn();
    } catch (error) {
      log(`${label} error: ${error?.data?.message || error.message}`);
    }
  };

  const ensureConnected = () => {
    if (!connected) {
      log("Connect first to use API tools.");
      return false;
    }
    return true;
  };

  const loadTrader = () =>
    handle("Trader", async () => {
      if (!ensureConnected()) return;
      setTrader(await apiGet("/trader"));
    });

  const loadLimits = () =>
    handle("Limits", async () => {
      if (!ensureConnected()) return;
      setLimits(await apiGet("/limits"));
    });

  const loadNews = () =>
    handle("News", async () => {
      if (!ensureConnected()) return;
      setNews(
        await apiGet("/news", {
          since: parseNumber(newsSince),
          limit: parseNumber(newsLimit),
        })
      );
    });

  const loadAssets = () =>
    handle("Assets", async () => {
      if (!ensureConnected()) return;
      setAssets(await apiGet("/assets"));
    });

  const loadAssetHistory = () =>
    handle("Asset history", async () => {
      if (!ensureConnected()) return;
      setAssetHistory(
        await apiGet("/assets/history", {
          ticker: effectiveAssetHistoryTicker || undefined,
          limit: parseNumber(assetHistoryLimit),
        })
      );
    });

  const loadTas = () =>
    handle("Time & sales", async () => {
      if (!ensureConnected()) return;
      setTas(
        await apiGet("/securities/tas", {
          ticker: selectedTicker,
          after: parseNumber(tasAfter),
          limit: parseNumber(tasLimit),
        })
      );
    });

  const loadOrderDetail = () =>
    handle("Order detail", async () => {
      if (!ensureConnected()) return;
      if (!orderDetailId) return;
      setOrderDetail(await apiGet(`/orders/${orderDetailId}`));
    });

  const loadTenders = () =>
    handle("Tenders", async () => {
      if (!ensureConnected()) return;
      setTenders(await apiGet("/tenders"));
    });

  const acceptTender = (tender) =>
    handle("Tender accept", async () => {
      if (!ensureConnected()) return;
      const price = tenderPrices[tender.tender_id];
      const params = tender.is_fixed_bid ? {} : { price: parseNumber(price) };
      await apiPost(`/tenders/${tender.tender_id}`, params);
      log(`Tender ${tender.tender_id} accepted.`);
      loadTenders();
    });

  const declineTender = (tenderId) =>
    handle("Tender decline", async () => {
      if (!ensureConnected()) return;
      await apiDelete(`/tenders/${tenderId}`);
      log(`Tender ${tenderId} declined.`);
      loadTenders();
    });

  const loadLeases = () =>
    handle("Leases", async () => {
      if (!ensureConnected()) return;
      setLeases(await apiGet("/leases"));
    });

  const createLease = () =>
    handle("Lease", async () => {
      if (!ensureConnected()) return;
      if (!effectiveLeaseTicker) return;
      // Defaults here keep the form honest without extra effects. (Lazy, but in a good way.)
      const params = buildLeaseParams({ ...leaseForm, ticker: effectiveLeaseTicker });
      const lease = await apiPost("/leases", params);
      log(`Lease created for ${lease.ticker || effectiveLeaseTicker}.`);
      setLeases((prev) => [lease, ...prev]);
    });

  const getLeaseDetail = () =>
    handle("Lease detail", async () => {
      if (!ensureConnected()) return;
      if (!leaseDetailId) return;
      setLeaseDetail(await apiGet(`/leases/${leaseDetailId}`));
    });

  const useLease = () =>
    handle("Use lease", async () => {
      if (!ensureConnected()) return;
      if (!leaseDetailId) return;
      const params = buildLeaseParams({ ticker: "", ...leaseUseForm });
      await apiPost(`/leases/${leaseDetailId}`, params);
      log(`Lease ${leaseDetailId} used.`);
      loadLeases();
    });

  const unlease = (leaseId) =>
    handle("Unlease", async () => {
      if (!ensureConnected()) return;
      if (!leaseId) return;
      await apiDelete(`/leases/${leaseId}`);
      log(`Lease ${leaseId} released.`);
      loadLeases();
    });

  const bulkCancel = () =>
    handle("Bulk cancel", async () => {
      if (!ensureConnected()) return;
      const params = {};
      if (bulkMode === "all") params.all = 1;
      if (bulkMode === "ticker") params.ticker = bulkValue;
      if (bulkMode === "ids") params.ids = bulkValue;
      if (bulkMode === "query") params.query = bulkValue;
      const result = await apiPost("/commands/cancel", params);
      setBulkResult(result);
      log("Bulk cancel executed.");
    });

  if (!connected) {
    return (
      <section className="card">
        <div className="card-title">API Toolkit</div>
        <div className="muted">Connect first to access the full API toolbox.</div>
      </section>
    );
  }

  return (
    <section className="card api-lab">
      <div className="card-title">API Toolkit</div>
      <div className="api-grid">
        <details>
          <summary>Trader & Limits</summary>
          <div className="api-section">
            <div className="api-actions">
              <button type="button" className="ghost" onClick={loadTrader}>
                Load Trader
              </button>
              <button type="button" className="ghost" onClick={loadLimits}>
                Load Limits
              </button>
            </div>
            <JsonBlock data={trader} />
            <JsonBlock data={limits} />
          </div>
        </details>

        <details>
          <summary>News</summary>
          <div className="api-section">
            <div className="api-actions">
              <input
                placeholder="since"
                value={newsSince}
                onChange={(event) => setNewsSince(event.target.value)}
              />
              <input
                placeholder="limit"
                value={newsLimit}
                onChange={(event) => setNewsLimit(event.target.value)}
              />
              <button type="button" className="ghost" onClick={loadNews}>
                Fetch News
              </button>
            </div>
            <JsonBlock data={news} />
          </div>
        </details>

        <details>
          <summary>Assets & History</summary>
          <div className="api-section">
            <div className="api-actions">
              <button type="button" className="ghost" onClick={loadAssets}>
                Load Assets
              </button>
            </div>
            <JsonBlock data={assets} />
            <div className="api-actions">
              <input
                placeholder="ticker"
                value={effectiveAssetHistoryTicker}
                onChange={(event) => setAssetHistoryTicker(event.target.value)}
              />
              <input
                placeholder="limit"
                value={assetHistoryLimit}
                onChange={(event) => setAssetHistoryLimit(event.target.value)}
              />
              <button type="button" className="ghost" onClick={loadAssetHistory}>
                Load Asset History
              </button>
            </div>
            <JsonBlock data={assetHistory} />
          </div>
        </details>

        <details>
          <summary>Time & Sales</summary>
          <div className="api-section">
            <div className="api-actions">
              <div className="pill">Ticker: {selectedTicker || "—"}</div>
              <input
                placeholder="after"
                value={tasAfter}
                onChange={(event) => setTasAfter(event.target.value)}
              />
              <input
                placeholder="limit"
                value={tasLimit}
                onChange={(event) => setTasLimit(event.target.value)}
              />
              <button type="button" className="ghost" onClick={loadTas}>
                Fetch TAS
              </button>
            </div>
            <JsonBlock data={tas} />
          </div>
        </details>

        <details>
          <summary>Order Details</summary>
          <div className="api-section">
            <div className="api-actions">
              <input
                placeholder="order id"
                value={orderDetailId}
                onChange={(event) => setOrderDetailId(event.target.value)}
              />
              <button type="button" className="ghost" onClick={loadOrderDetail}>
                Load Order
              </button>
            </div>
            <JsonBlock data={orderDetail} />
          </div>
        </details>

        <details>
          <summary>Tenders</summary>
          <div className="api-section">
            <div className="api-actions">
              <button type="button" className="ghost" onClick={loadTenders}>
                Refresh Tenders
              </button>
            </div>
            {tenders.length === 0 ? (
              <div className="muted">No active tenders.</div>
            ) : (
              <div className="list">
                {tenders.map((tender) => (
                  <div key={tender.tender_id} className="list-row">
                    <div>
                      <strong>{tender.caption}</strong>
                      <div className="muted">
                        {tender.action} {tender.quantity} @ {tender.price ?? "MKT"}
                      </div>
                    </div>
                    {!tender.is_fixed_bid && (
                      <input
                        placeholder="price"
                        value={tenderPrices[tender.tender_id] || ""}
                        onChange={(event) =>
                          setTenderPrices((prev) => ({
                            ...prev,
                            [tender.tender_id]: event.target.value,
                          }))
                        }
                      />
                    )}
                    <button type="button" className="ghost" onClick={() => acceptTender(tender)}>
                      Accept
                    </button>
                    <button type="button" className="ghost" onClick={() => declineTender(tender.tender_id)}>
                      Decline
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>

        <details>
          <summary>Leases</summary>
          <div className="api-section">
            <div className="api-actions">
              <button type="button" className="ghost" onClick={loadLeases}>
                Refresh Leases
              </button>
            </div>
            <JsonBlock data={leases} />
            <div className="api-actions">
              <input
                placeholder="ticker"
                value={effectiveLeaseTicker}
                onChange={(event) => setLeaseForm((prev) => ({ ...prev, ticker: event.target.value }))}
              />
              <input
                placeholder="from1"
                value={leaseForm.from1}
                onChange={(event) => setLeaseForm((prev) => ({ ...prev, from1: event.target.value }))}
              />
              <input
                placeholder="qty1"
                value={leaseForm.quantity1}
                onChange={(event) => setLeaseForm((prev) => ({ ...prev, quantity1: event.target.value }))}
              />
              <button type="button" className="ghost" onClick={createLease}>
                Create Lease
              </button>
            </div>
            <div className="api-actions">
              <input
                placeholder="lease id"
                value={leaseDetailId}
                onChange={(event) => setLeaseDetailId(event.target.value)}
              />
              <button type="button" className="ghost" onClick={getLeaseDetail}>
                Load Lease
              </button>
              <button type="button" className="ghost" onClick={() => unlease(leaseDetailId)}>
                Unlease
              </button>
            </div>
            <JsonBlock data={leaseDetail} />
            <div className="api-actions">
              <input
                placeholder="use from1"
                value={leaseUseForm.from1}
                onChange={(event) => setLeaseUseForm((prev) => ({ ...prev, from1: event.target.value }))}
              />
              <input
                placeholder="use qty1"
                value={leaseUseForm.quantity1}
                onChange={(event) => setLeaseUseForm((prev) => ({ ...prev, quantity1: event.target.value }))}
              />
              <button type="button" className="ghost" onClick={useLease}>
                Use Lease
              </button>
            </div>
          </div>
        </details>

        <details>
          <summary>Bulk Cancel</summary>
          <div className="api-section">
            <div className="api-actions">
              <select value={bulkMode} onChange={(event) => setBulkMode(event.target.value)}>
                <option value="all">All</option>
                <option value="ticker">By Ticker</option>
                <option value="ids">By IDs</option>
                <option value="query">By Query</option>
              </select>
              {bulkMode !== "all" && (
                <input
                  placeholder="value"
                  value={bulkValue}
                  onChange={(event) => setBulkValue(event.target.value)}
                />
              )}
              <button type="button" className="ghost" onClick={bulkCancel}>
                Execute
              </button>
            </div>
            <JsonBlock data={bulkResult} />
          </div>
        </details>
      </div>
    </section>
  );
}
