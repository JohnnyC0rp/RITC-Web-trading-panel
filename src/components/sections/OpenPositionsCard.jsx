/**
 * OpenPositionsCard shows current directional exposure with entry and live PnL.
 */
export default function OpenPositionsCard({
  requiresConnectionClass,
  openPositionRows,
  formatQty,
  formatNumber,
}) {
  return (
    <section className={`card compact-card ${requiresConnectionClass}`.trim()}>
      <div className="card-title">Open Positions</div>
      <div className="orders-list">
        {openPositionRows.length === 0 && <div className="muted">No open positions.</div>}
        {openPositionRows.map((position) => {
          const tone = position.pnl == null ? "" : position.pnl < 0 ? "negative" : "positive";
          const sideLabel = position.qty > 0 ? "Long" : "Short";
          const sideClass =
            position.qty > 0 ? "position-side position-side--long" : "position-side position-side--short";
          return (
            <div key={position.ticker} className="order-row position-row">
              <div>
                <strong>{position.ticker}</strong>
                <div className="muted">
                  <span className={sideClass}>{sideLabel}</span> · Qty {formatQty(position.qty)} · Entry{" "}
                  {position.entry != null ? formatNumber(position.entry) : "—"}
                </div>
              </div>
              <div className="position-pnl">
                <span>PnL</span>
                <strong className={`pnl-value ${tone}`}>
                  {position.pnl != null ? formatNumber(position.pnl, 2) : "—"}
                </strong>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
