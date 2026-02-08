import { useRef } from "react";
import Plot from "react-plotly.js";

export default function PlotlyCandles({
  data,
  layout,
  config,
  height,
  onRelayout,
  onChartTradeIntent,
  chartTradingEnabled,
}) {
  const hoverPriceRef = useRef(null);

  const pickPointPrice = (point) => {
    if (!point) return null;
    const candidate = point.y ?? point.close ?? point.open ?? point.high ?? point.low;
    const num = Number(candidate);
    return Number.isFinite(num) ? num : null;
  };

  return (
    <div
      style={{ width: "100%", height: `${height}px` }}
      onContextMenu={(event) => {
        if (!chartTradingEnabled || !onChartTradeIntent) return;
        event.preventDefault();
        const hovered = hoverPriceRef.current;
        if (Number.isFinite(hovered)) {
          onChartTradeIntent("right", hovered);
        }
      }}
    >
      <Plot
        data={data}
        layout={layout}
        config={config}
        style={{ width: "100%", height: `${height}px` }}
        onRelayout={onRelayout}
        onHover={(event) => {
          const point = event?.points?.[0];
          hoverPriceRef.current = pickPointPrice(point);
        }}
        onClick={(event) => {
          if (!chartTradingEnabled || !onChartTradeIntent) return;
          const point = event?.points?.[0];
          const price = pickPointPrice(point);
          if (Number.isFinite(price)) {
            onChartTradeIntent("left", price);
          }
        }}
      />
    </div>
  );
}
