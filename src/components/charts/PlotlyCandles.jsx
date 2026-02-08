import Plot from "react-plotly.js";

export default function PlotlyCandles({
  data,
  layout,
  config,
  height,
  onRelayout,
}) {
  return (
    <Plot
      data={data}
      layout={layout}
      config={config}
      style={{ width: "100%", height: `${height}px` }}
      onRelayout={onRelayout}
    />
  );
}
