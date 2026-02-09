import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { getChartPalette } from "./chartPalette";

const toScatterPoint = (point) => [String(point.tick), point.price];

export default function EChartsCandles({
  candles,
  dealPoints,
  openFillPoints,
  closeFillPoints,
  limitLevels,
  stopLossLevels,
  takeProfitLevels,
  referenceLevels,
  showRangeSlider,
  theme,
  height,
  autoScale = false,
  lockedYRange = null,
}) {
  const option = useMemo(() => {
    const palette = getChartPalette(theme);
    const ticks = candles.map((candle) => String(candle.tick));

    const openBuys = openFillPoints.filter((point) => point.side === "BUY");
    const openSells = openFillPoints.filter((point) => point.side === "SELL");
    const closeBuys = closeFillPoints.filter((point) => point.side === "BUY");
    const closeSells = closeFillPoints.filter((point) => point.side === "SELL");
    const lineLevels = [
      ...limitLevels.map((level) => ({
        name: level.side === "BUY" ? `LMT B x${level.count}` : `LMT S x${level.count}`,
        yAxis: level.price,
        lineStyle: {
          color: level.side === "BUY" ? "#2563eb" : "#f97316",
          type: "dotted",
          width: 1.2,
        },
      })),
      ...stopLossLevels.map((level) => ({
        name: `SL x${level.count}`,
        yAxis: level.price,
        lineStyle: { color: "#dc2626", type: "dashed", width: 1.1 },
      })),
      ...takeProfitLevels.map((level) => ({
        name: `TP x${level.count}`,
        yAxis: level.price,
        lineStyle: { color: "#16a34a", type: "dashed", width: 1.1 },
      })),
      ...referenceLevels.map((level) => ({
        name: level.label || "Reference",
        yAxis: level.price,
        lineStyle: {
          color: level.color || "#475569",
          type:
            level.style === "dot"
              ? "dotted"
              : level.style === "dash"
                ? "dashed"
                : "solid",
          width: 1.1,
        },
      })),
    ];
    const yValues = [
      ...candles.flatMap((candle) => [candle.low, candle.high, candle.open, candle.close]),
      ...lineLevels.map((line) => line.yAxis),
      ...dealPoints.map((point) => point.price),
      ...openFillPoints.map((point) => point.price),
      ...closeFillPoints.map((point) => point.price),
    ]
      .map((value) => Number(value))
      .filter(Number.isFinite);
    const minValue = yValues.length ? Math.min(...yValues) : null;
    const maxValue = yValues.length ? Math.max(...yValues) : null;
    const spread =
      Number.isFinite(minValue) && Number.isFinite(maxValue) ? maxValue - minValue : null;
    const padding =
      Number.isFinite(spread) && spread > 0
        ? spread * 0.08
        : Number.isFinite(maxValue)
          ? Math.max(Math.abs(maxValue) * 0.02, 1)
          : 1;
    const dynamicYRange =
      Number.isFinite(minValue) && Number.isFinite(maxValue)
        ? [minValue - padding, maxValue + padding]
        : null;
    const yRange =
      !autoScale && Array.isArray(lockedYRange) ? lockedYRange : dynamicYRange;
    return {
      animation: false,
      backgroundColor: palette.background,
      tooltip: {
        trigger: "axis",
      },
      legend: {
        top: 0,
        textStyle: { color: palette.text },
      },
      grid: {
        left: 42,
        right: 22,
        top: 30,
        bottom: showRangeSlider ? 62 : 32,
      },
      xAxis: {
        type: "category",
        data: ticks,
        boundaryGap: true,
        axisLine: { lineStyle: { color: palette.grid } },
        axisLabel: { color: palette.text, fontSize: 10 },
      },
      yAxis: {
        scale: true,
        min: autoScale ? undefined : yRange?.[0],
        max: autoScale ? undefined : yRange?.[1],
        axisLine: { lineStyle: { color: palette.grid } },
        splitLine: { lineStyle: { color: palette.grid } },
        axisLabel: { color: palette.text, fontSize: 10 },
      },
      dataZoom: showRangeSlider
        ? [
            { type: "inside" },
            {
              type: "slider",
              bottom: 12,
              borderColor: palette.border,
              textStyle: { color: palette.text },
            },
          ]
        : [{ type: "inside" }],
      series: [
        {
          name: "Candles",
          type: "candlestick",
          data: candles.map((candle) => [candle.open, candle.close, candle.low, candle.high]),
          itemStyle: {
            color: palette.up,
            color0: palette.down,
            borderColor: palette.up,
            borderColor0: palette.down,
          },
          markLine: lineLevels.length
            ? {
                symbol: "none",
                animation: false,
                label: { show: true, color: palette.text, fontSize: 10 },
                data: lineLevels,
              }
            : undefined,
        },
        ...(dealPoints.length
          ? [
              {
                name: "Deals",
                type: "scatter",
                symbolSize: 4,
                itemStyle: { color: palette.deal },
                data: dealPoints.map(toScatterPoint),
              },
            ]
          : []),
        ...(openBuys.length
          ? [
              {
                name: "Open Buy",
                type: "scatter",
                symbol: "triangle",
                symbolSize: 10,
                itemStyle: { color: palette.openBuy },
                data: openBuys.map(toScatterPoint),
              },
            ]
          : []),
        ...(openSells.length
          ? [
              {
                name: "Open Sell",
                type: "scatter",
                symbol: "triangle",
                symbolSize: 10,
                symbolRotate: 180,
                itemStyle: { color: palette.openSell },
                data: openSells.map(toScatterPoint),
              },
            ]
          : []),
        ...(closeBuys.length
          ? [
              {
                name: "Close Buy",
                type: "scatter",
                symbol: "circle",
                symbolSize: 8,
                itemStyle: { color: palette.closeBuy },
                data: closeBuys.map(toScatterPoint),
              },
            ]
          : []),
        ...(closeSells.length
          ? [
              {
                name: "Close Sell",
                type: "scatter",
                symbol: "circle",
                symbolSize: 8,
                itemStyle: { color: palette.closeSell },
                data: closeSells.map(toScatterPoint),
              },
            ]
          : []),
      ],
    };
  }, [
    candles,
    closeFillPoints,
    dealPoints,
    limitLevels,
    openFillPoints,
    referenceLevels,
    showRangeSlider,
    stopLossLevels,
    takeProfitLevels,
    theme,
    autoScale,
    lockedYRange,
  ]);

  return (
    <ReactECharts
      option={option}
      style={{ width: "100%", height: `${height}px`, background: "#ffffff" }}
      notMerge
      lazyUpdate
      opts={{ renderer: "canvas" }}
    />
  );
}
