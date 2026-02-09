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
  limitLevels,
  stopLossLevels,
  takeProfitLevels,
  referenceLevels = [],
  showRangeSlider,
  theme,
  height,
  plotlyData,
  plotlyLayout,
  plotlyConfig,
  onPlotlyRelayout,
  onChartTradeIntent,
  chartTradingEnabled,
  autoScale,
  lockedYRange,
}) {
  if (renderer === "lightweight") {
    return (
      <LightweightCandles
        candles={candles}
        dealPoints={dealPoints}
        openFillPoints={openFillPoints}
        closeFillPoints={closeFillPoints}
        limitLevels={limitLevels}
        stopLossLevels={stopLossLevels}
        takeProfitLevels={takeProfitLevels}
        referenceLevels={referenceLevels}
        onChartTradeIntent={onChartTradeIntent}
        chartTradingEnabled={chartTradingEnabled}
        theme={theme}
        height={height}
        autoScale={autoScale}
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
        limitLevels={limitLevels}
        stopLossLevels={stopLossLevels}
        takeProfitLevels={takeProfitLevels}
        referenceLevels={referenceLevels}
        showRangeSlider={showRangeSlider}
        theme={theme}
        height={height}
        autoScale={autoScale}
        lockedYRange={lockedYRange}
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
        limitLevels={limitLevels}
        stopLossLevels={stopLossLevels}
        takeProfitLevels={takeProfitLevels}
        referenceLevels={referenceLevels}
        showRangeSlider={showRangeSlider}
        theme={theme}
        height={height}
        autoScale={autoScale}
        lockedYRange={lockedYRange}
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
        limitLevels={limitLevels}
        stopLossLevels={stopLossLevels}
        takeProfitLevels={takeProfitLevels}
        referenceLevels={referenceLevels}
        theme={theme}
        height={height}
        autoScale={autoScale}
        lockedYRange={lockedYRange}
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
      onChartTradeIntent={onChartTradeIntent}
      chartTradingEnabled={chartTradingEnabled}
      autoScale={autoScale}
    />
  );
}
