import D3Candles from "./D3Candles";
import EChartsCandles from "./EChartsCandles";
import HighchartsCandles from "./HighchartsCandles";
import LightweightCandles from "./LightweightCandles";
import PlotlyCandles from "./PlotlyCandles";

export default function CandlesRenderer({
  renderer,
  candles,
  dealPoints,
  openFillPoints,
  closeFillPoints,
  showRangeSlider,
  theme,
  height,
  plotlyData,
  plotlyLayout,
  plotlyConfig,
  onPlotlyRelayout,
}) {
  if (renderer === "lightweight") {
    return (
      <LightweightCandles
        candles={candles}
        dealPoints={dealPoints}
        openFillPoints={openFillPoints}
        closeFillPoints={closeFillPoints}
        theme={theme}
        height={height}
      />
    );
  }

  if (renderer === "echarts") {
    return (
      <EChartsCandles
        candles={candles}
        dealPoints={dealPoints}
        openFillPoints={openFillPoints}
        closeFillPoints={closeFillPoints}
        showRangeSlider={showRangeSlider}
        theme={theme}
        height={height}
      />
    );
  }

  if (renderer === "highcharts") {
    return (
      <HighchartsCandles
        candles={candles}
        dealPoints={dealPoints}
        openFillPoints={openFillPoints}
        closeFillPoints={closeFillPoints}
        showRangeSlider={showRangeSlider}
        theme={theme}
        height={height}
      />
    );
  }

  if (renderer === "d3") {
    return (
      <D3Candles
        candles={candles}
        dealPoints={dealPoints}
        openFillPoints={openFillPoints}
        closeFillPoints={closeFillPoints}
        theme={theme}
        height={height}
      />
    );
  }

  return (
    <PlotlyCandles
      data={plotlyData}
      layout={plotlyLayout}
      config={plotlyConfig}
      height={height}
      onRelayout={onPlotlyRelayout}
    />
  );
}
