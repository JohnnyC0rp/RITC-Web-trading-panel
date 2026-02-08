/**
 * OpenOrdersCard renders active orders and bracket values.
 * Search tip: "SL" / "TP" labels appear in the order subtitle row.
 */
export default function OpenOrdersCard({
  requiresConnectionClass,
  orders,
  handleCancel,
  getOrderStopLoss,
  getOrderTakeProfit,
}) {
  return (
    <section className={`card compact-card ${requiresConnectionClass}`.trim()}>
      <div className="card-title">Open Orders</div>
      <div className="orders-list">
        {orders.length === 0 && <div className="muted">No open orders yet.</div>}
        {orders.map((order) => {
          const orderId = order.order_id ?? order.id;
          const stopLoss = getOrderStopLoss(order);
          const takeProfit = getOrderTakeProfit(order);
          return (
            <div key={orderId} className="order-row">
              <div>
                <strong>{order.ticker}</strong>
                <div className="muted">
                  {order.action} {order.quantity} @ {order.price ?? "MKT"}
                  {(stopLoss != null || takeProfit != null) && (
                    <>
                      {" · "}
                      SL {stopLoss != null ? stopLoss : "—"} · TP {takeProfit != null ? takeProfit : "—"}
                    </>
                  )}
                </div>
              </div>
              <button type="button" className="ghost" onClick={() => handleCancel(orderId)}>
                Cancel
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
