/**
 * OrderbookSection keeps all order-book + candles layout concerns in one place.
 * Search tips:
 * - "display mode" for Books/Candles toggles
 * - "handleBookOrder" for mouse-to-order mapping
 * - "book-center-hint" for centering helper copy
 */
export default function OrderbookSection({
  requiresConnectionClass,
  bookView,
  setBookView,
  orderbookDisplayOptions,
  orderbookDisplayMode,
  setOrderbookDisplayMode,
  addBookPanel,
  showOrderbookPanels,
  splitOrderbookLayout,
  bookStates,
  securities,
  updateBookPanelTicker,
  removeBookPanel,
  bookPanelPrimaryId,
  bookScrollRef,
  bookScrollRefs,
  getVolumeTone,
  formatQty,
  formatPriceSet,
  placeQuickOrder,
  showCandlesPanel,
  isMultiBook,
  renderChartPanel,
}) {
  return (
    <section className={`card orderbook-shell ${requiresConnectionClass}`.trim()}>
      <div className="orderbook-header">
        <div>
          <div className="card-title">Order Books</div>
          <div className="muted">Book trader or ladder trader, with compact rows.</div>
        </div>
        <div className="orderbook-actions">
          <div className="segmented segmented--compact">
            <button
              type="button"
              className={bookView === "book" ? "active" : ""}
              onClick={() => setBookView("book")}
            >
              Book Trader
            </button>
            <button
              type="button"
              className={bookView === "ladder" ? "active" : ""}
              onClick={() => setBookView("ladder")}
            >
              Ladder Trader
            </button>
          </div>
          <div className="segmented segmented--compact">
            {orderbookDisplayOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={orderbookDisplayMode === option.id ? "active" : ""}
                onClick={() => setOrderbookDisplayMode(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ghost small"
            onClick={addBookPanel}
            disabled={!showOrderbookPanels}
          >
            Add Book
          </button>
        </div>
      </div>

      <div className={`orderbook-layout ${splitOrderbookLayout ? "single" : "multi"}`}>
        {showOrderbookPanels && (
          <div className="orderbook-grid">
            {bookStates.map(({ panel, state }) => {
              const panelOrders = state.ordersByPrice;
              return (
                <div key={panel.id} className={`book-panel ${bookView}`}>
                  <div className="book-panel-header">
                    <div className="book-panel-controls">
                      <select
                        value={panel.ticker}
                        onChange={(event) => updateBookPanelTicker(panel.id, event.target.value)}
                      >
                        <option value="">Select</option>
                        {securities.map((sec) => (
                          <option key={sec.ticker} value={sec.ticker}>
                            {sec.ticker}
                          </option>
                        ))}
                      </select>
                      <span className="book-center-hint">Use C to center view</span>
                    </div>
                    {panel.id !== bookPanelPrimaryId && (
                      <button
                        type="button"
                        className="ghost small"
                        onClick={() => removeBookPanel(panel.id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className={`book-table ${bookView}`}>
                    <div className="book-head">
                      {bookView === "book" ? (
                        <>
                          <span>Trader</span>
                          <span>Volume</span>
                          <span>Price</span>
                          <span>Price</span>
                          <span>Volume</span>
                          <span>Trader</span>
                        </>
                      ) : (
                        <>
                          <span>Bid</span>
                          <span>Price</span>
                          <span>Ask</span>
                        </>
                      )}
                    </div>

                    <div
                      className={`book-scroll ${bookView}`}
                      ref={(node) => {
                        if (panel.id === bookPanelPrimaryId) {
                          bookScrollRef.current = node;
                        }
                        if (node) {
                          bookScrollRefs.current[panel.id] = node;
                        } else {
                          delete bookScrollRefs.current[panel.id];
                        }
                      }}
                    >
                      {state.rows.map((row, index) => {
                        const bidRatio = row.bidQty / state.maxVolume;
                        const askRatio = row.askQty / state.maxVolume;
                        const bidTone = getVolumeTone(bidRatio);
                        const askTone = getVolumeTone(askRatio);
                        const myOrders =
                          panelOrders.get(row.key) || {
                            buyQty: 0,
                            buyCount: 0,
                            sellQty: 0,
                            sellCount: 0,
                            buyStops: new Set(),
                            buyTargets: new Set(),
                            sellStops: new Set(),
                            sellTargets: new Set(),
                          };
                        const hasOrders = myOrders.buyCount || myOrders.sellCount;
                        const bidTrader = myOrders.buyCount ? "ME" : "ANON";
                        const askTrader = myOrders.sellCount ? "ME" : "ANON";
                        const buyStopLabel = formatPriceSet(myOrders.buyStops);
                        const buyTargetLabel = formatPriceSet(myOrders.buyTargets);
                        const sellStopLabel = formatPriceSet(myOrders.sellStops);
                        const sellTargetLabel = formatPriceSet(myOrders.sellTargets);
                        const bestBid = Number(state.bestBidPrice ?? state.midPrice);
                        const bestAsk = Number(state.bestAskPrice ?? state.midPrice);
                        const isBidZone = Number.isFinite(bestBid)
                          ? row.price <= bestBid
                          : row.price <= state.midPrice;
                        const isAskZone = Number.isFinite(bestAsk)
                          ? row.price >= bestAsk
                          : row.price >= state.midPrice;
                        const entryArrow =
                          row.entryDirection === "down"
                            ? "↓"
                            : row.entryDirection === "up"
                              ? "↑"
                              : "";

                        const handleBookOrder = (event, intent) => {
                          event.preventDefault();
                          if (!panel.ticker || row.isSpread) return;
                          if (intent === "buy") {
                            if (isBidZone) {
                              placeQuickOrder(panel.ticker, "BUY", row.price, false, "book");
                            } else if (isAskZone) {
                              placeQuickOrder(panel.ticker, "BUY", row.price, true, "book");
                            }
                            return;
                          }
                          if (isAskZone) {
                            placeQuickOrder(panel.ticker, "SELL", row.price, false, "book");
                          } else if (isBidZone) {
                            placeQuickOrder(panel.ticker, "SELL", row.price, true, "book");
                          }
                        };

                        return (
                          <div
                            key={`${panel.id}-${row.price}-${index}`}
                            className={`book-row ${bookView} ${row.isMid ? "mid" : ""} ${
                              row.isSpread ? "spread" : ""
                            } ${hasOrders ? "has-orders" : ""}`}
                            data-center={row.isCenter ? "true" : undefined}
                            onClick={(event) => handleBookOrder(event, "buy")}
                            onContextMenu={(event) => handleBookOrder(event, "sell")}
                          >
                            {bookView === "book" ? (
                              <>
                                <span className={`book-cell trader ${myOrders.buyCount ? "mine" : ""}`}>
                                  {bidTrader}
                                </span>
                                <span
                                  className={`book-cell volume bid ${
                                    row.pnlTone && row.pnlSide === "long" ? `pnl-${row.pnlTone}` : ""
                                  }`}
                                >
                                  {row.pnlTone && row.pnlSide === "long" && (
                                    <span className="book-pnl" />
                                  )}
                                  <span
                                    className={`book-bar ${bidTone}`}
                                    style={{ width: `${Math.round(bidRatio * 100)}%` }}
                                  />
                                  {myOrders.buyCount ? (
                                    <span className="book-meta">
                                      <span className="book-chip">{formatQty(myOrders.buyCount)}x</span>
                                      <span className="book-chip">{formatQty(myOrders.buyQty)}</span>
                                      {buyStopLabel && (
                                        <span className="book-chip book-chip--sl">SL {buyStopLabel}</span>
                                      )}
                                      {buyTargetLabel && (
                                        <span className="book-chip book-chip--tp">TP {buyTargetLabel}</span>
                                      )}
                                    </span>
                                  ) : null}
                                  <span className="book-value">{formatQty(row.bidQty)}</span>
                                </span>

                                <span
                                  className={`price bid-price ${row.isMid ? "mid" : ""} ${
                                    row.isEntry && row.pnlSide === "long" ? "entry" : ""
                                  }`}
                                >
                                  {row.isEntry && row.pnlSide === "long" && entryArrow && (
                                    <span className={`book-entry ${row.entryDirection} ${row.entryTone || ""}`}>
                                      {entryArrow}
                                    </span>
                                  )}
                                  {row.price.toFixed(state.quotedDecimals)}
                                  {row.hasStopLoss && <span className="book-risk-tag sl">SL</span>}
                                  {row.hasTakeProfit && <span className="book-risk-tag tp">TP</span>}
                                </span>

                                <span
                                  className={`price ask-price ${row.isMid ? "mid" : ""} ${
                                    row.isEntry && row.pnlSide === "short" ? "entry" : ""
                                  }`}
                                >
                                  {row.isEntry && row.pnlSide === "short" && entryArrow && (
                                    <span className={`book-entry ${row.entryDirection} ${row.entryTone || ""}`}>
                                      {entryArrow}
                                    </span>
                                  )}
                                  {row.price.toFixed(state.quotedDecimals)}
                                  {row.hasStopLoss && <span className="book-risk-tag sl">SL</span>}
                                  {row.hasTakeProfit && <span className="book-risk-tag tp">TP</span>}
                                </span>

                                <span
                                  className={`book-cell volume ask ${
                                    row.pnlTone && row.pnlSide === "short" ? `pnl-${row.pnlTone}` : ""
                                  }`}
                                >
                                  {row.pnlTone && row.pnlSide === "short" && (
                                    <span className="book-pnl" />
                                  )}
                                  <span
                                    className={`book-bar ${askTone}`}
                                    style={{ width: `${Math.round(askRatio * 100)}%` }}
                                  />
                                  {myOrders.sellCount ? (
                                    <span className="book-meta">
                                      <span className="book-chip">{formatQty(myOrders.sellCount)}x</span>
                                      <span className="book-chip">{formatQty(myOrders.sellQty)}</span>
                                      {sellStopLabel && (
                                        <span className="book-chip book-chip--sl">SL {sellStopLabel}</span>
                                      )}
                                      {sellTargetLabel && (
                                        <span className="book-chip book-chip--tp">TP {sellTargetLabel}</span>
                                      )}
                                    </span>
                                  ) : null}
                                  <span className="book-value">{formatQty(row.askQty)}</span>
                                </span>
                                <span className={`book-cell trader ${myOrders.sellCount ? "mine" : ""}`}>
                                  {askTrader}
                                </span>
                              </>
                            ) : (
                              <>
                                <span
                                  className={`book-cell bid ${
                                    row.pnlTone && row.pnlSide === "long" ? `pnl-${row.pnlTone}` : ""
                                  }`}
                                >
                                  {row.pnlTone && row.pnlSide === "long" && (
                                    <span className="book-pnl" />
                                  )}
                                  <span
                                    className={`book-bar ${bidTone}`}
                                    style={{ width: `${Math.round(bidRatio * 100)}%` }}
                                  />
                                  {myOrders.buyCount ? (
                                    <span className="book-meta">
                                      <span className="book-chip">{formatQty(myOrders.buyCount)}x</span>
                                      <span className="book-chip">{formatQty(myOrders.buyQty)}</span>
                                      {buyStopLabel && (
                                        <span className="book-chip book-chip--sl">SL {buyStopLabel}</span>
                                      )}
                                      {buyTargetLabel && (
                                        <span className="book-chip book-chip--tp">TP {buyTargetLabel}</span>
                                      )}
                                    </span>
                                  ) : null}
                                  <span className="book-value">{formatQty(row.bidQty)}</span>
                                </span>

                                <span className={`price ${row.isMid ? "mid" : ""} ${row.isEntry ? "entry" : ""}`}>
                                  {row.isEntry && entryArrow && (
                                    <span className={`book-entry ${row.entryDirection} ${row.entryTone || ""}`}>
                                      {entryArrow}
                                    </span>
                                  )}
                                  {row.price.toFixed(state.quotedDecimals)}
                                  {row.hasStopLoss && <span className="book-risk-tag sl">SL</span>}
                                  {row.hasTakeProfit && <span className="book-risk-tag tp">TP</span>}
                                </span>

                                <span
                                  className={`book-cell ask ${
                                    row.pnlTone && row.pnlSide === "short" ? `pnl-${row.pnlTone}` : ""
                                  }`}
                                >
                                  {row.pnlTone && row.pnlSide === "short" && (
                                    <span className="book-pnl" />
                                  )}
                                  <span
                                    className={`book-bar ${askTone}`}
                                    style={{ width: `${Math.round(askRatio * 100)}%` }}
                                  />
                                  {myOrders.sellCount ? (
                                    <span className="book-meta">
                                      <span className="book-chip">{formatQty(myOrders.sellCount)}x</span>
                                      <span className="book-chip">{formatQty(myOrders.sellQty)}</span>
                                      {sellStopLabel && (
                                        <span className="book-chip book-chip--sl">SL {sellStopLabel}</span>
                                      )}
                                      {sellTargetLabel && (
                                        <span className="book-chip book-chip--tp">TP {sellTargetLabel}</span>
                                      )}
                                    </span>
                                  ) : null}
                                  <span className="book-value">{formatQty(row.askQty)}</span>
                                </span>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {showCandlesPanel && renderChartPanel(showOrderbookPanels && isMultiBook)}
      </div>
    </section>
  );
}
