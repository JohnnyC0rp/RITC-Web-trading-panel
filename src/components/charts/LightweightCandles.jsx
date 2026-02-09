import { useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";
import { getChartPalette } from "./chartPalette";

const TIME_BASE = 1_700_000_000;
const STEP_SECONDS = 60;

export default function LightweightCandles({
  candles,
  dealPoints,
  openFillPoints,
  closeFillPoints,
  limitLevels,
  stopLossLevels,
  takeProfitLevels,
  referenceLevels,
  onChartTradeIntent,
  chartTradingEnabled,
  theme,
  height,
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !candles.length) return undefined;

    const palette = getChartPalette(theme);
    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        textColor: palette.text,
        background: { color: palette.background },
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: {
        borderColor: palette.border,
      },
      timeScale: {
        borderColor: palette.border,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        vertLine: { color: palette.border },
        horzLine: { color: palette.border },
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: palette.up,
      downColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
      borderVisible: false,
    });

    const tickToTime = new Map();
    const candleSeriesData = candles.map((candle, index) => {
      const time = TIME_BASE + index * STEP_SECONDS;
      tickToTime.set(candle.tick, time);
      return {
        time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      };
    });

    candleSeries.setData(candleSeriesData);

    const markerData = [
      // Deal markers stay small to avoid cluttering the candles (they are shy).
      ...dealPoints
        .map((deal) => {
          const time = tickToTime.get(deal.tick);
          if (!time) return null;
          return {
            time,
            position: "inBar",
            color: palette.deal,
            shape: "circle",
            size: 3,
          };
        })
        .filter(Boolean),
      ...openFillPoints
        .map((fill) => {
          const time = tickToTime.get(fill.tick);
          if (!time) return null;
          return {
            time,
            position: fill.side === "BUY" ? "belowBar" : "aboveBar",
            color: fill.side === "BUY" ? palette.openBuy : palette.openSell,
            shape: fill.side === "BUY" ? "arrowUp" : "arrowDown",
            text: "OPEN",
          };
        })
        .filter(Boolean),
      ...closeFillPoints
        .map((fill) => {
          const time = tickToTime.get(fill.tick);
          if (!time) return null;
          return {
            time,
            position: fill.side === "BUY" ? "belowBar" : "aboveBar",
            color: fill.side === "BUY" ? palette.closeBuy : palette.closeSell,
            shape: "circle",
            text: "CLOSE",
          };
        })
        .filter(Boolean),
    ]
      .filter((marker) => Number.isFinite(Number(marker.time)))
      .sort((a, b) => Number(a.time) - Number(b.time));

    candleSeries.setMarkers(markerData);

    const resolveLineStyle = (style) => {
      if (style === "dot") return 1;
      if (style === "dash") return 2;
      return 0;
    };

    const addPriceLine = (price, title, color, lineStyle = 2) => {
      const numeric = Number(price);
      if (!Number.isFinite(numeric)) return null;
      return candleSeries.createPriceLine({
        price: numeric,
        color,
        lineWidth: 1,
        lineStyle,
        axisLabelVisible: true,
        title,
      });
    };

    const priceLines = [
      ...limitLevels
        .map((level) =>
          addPriceLine(
            level.price,
            level.side === "BUY" ? `LMT B x${level.count}` : `LMT S x${level.count}`,
            level.side === "BUY" ? "#2563eb" : "#f97316",
            1
          )
        )
        .filter(Boolean),
      ...stopLossLevels
        .map((level) => addPriceLine(level.price, `SL x${level.count}`, "#dc2626", 2))
        .filter(Boolean),
      ...takeProfitLevels
        .map((level) => addPriceLine(level.price, `TP x${level.count}`, "#16a34a", 2))
        .filter(Boolean),
      ...referenceLevels
        .map((level) =>
          addPriceLine(
            level.price,
            level.label || "Ref",
            level.color || "#475569",
            resolveLineStyle(level.style)
          )
        )
        .filter(Boolean),
    ];

    const referencePrices = [
      ...limitLevels.map((level) => Number(level.price)),
      ...stopLossLevels.map((level) => Number(level.price)),
      ...takeProfitLevels.map((level) => Number(level.price)),
      ...referenceLevels.map((level) => Number(level.price)),
    ].filter((price) => Number.isFinite(price));
    if (referencePrices.length) {
      const candleLow = Math.min(...candleSeriesData.map((point) => Number(point.low)));
      const candleHigh = Math.max(...candleSeriesData.map((point) => Number(point.high)));
      const minBound = Math.min(candleLow, ...referencePrices);
      const maxBound = Math.max(candleHigh, ...referencePrices);
      candleSeries.applyOptions({
        autoscaleInfoProvider: (baseImplementation) => {
          const baseInfo =
            typeof baseImplementation === "function" ? baseImplementation() : null;
          const baseMin = Number(baseInfo?.priceRange?.minValue);
          const baseMax = Number(baseInfo?.priceRange?.maxValue);
          return {
            ...(baseInfo || {}),
            priceRange: {
              minValue: Number.isFinite(baseMin) ? Math.min(baseMin, minBound) : minBound,
              maxValue: Number.isFinite(baseMax) ? Math.max(baseMax, maxBound) : maxBound,
            },
          };
        },
      });
    }

    chart.timeScale().fitContent();

    const toPrice = (clientY) => {
      const rect = container.getBoundingClientRect();
      const y = clientY - rect.top;
      const numeric = candleSeries.coordinateToPrice(y);
      return Number.isFinite(Number(numeric)) ? Number(numeric) : null;
    };

    const handleClick = (event) => {
      if (!onChartTradeIntent) return;
      const clickedPrice = toPrice(event.clientY);
      if (clickedPrice == null) return;
      onChartTradeIntent("left", clickedPrice);
    };

    const handleContextMenu = (event) => {
      if (!onChartTradeIntent) return;
      event.preventDefault();
      const clickedPrice = toPrice(event.clientY);
      if (clickedPrice == null) return;
      onChartTradeIntent("right", clickedPrice);
    };

    container.addEventListener("click", handleClick);
    container.addEventListener("contextmenu", handleContextMenu);

    const resizeObserver = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect?.width;
      if (!nextWidth) return;
      chart.applyOptions({ width: nextWidth, height });
    });
    resizeObserver.observe(container);

    return () => {
      container.removeEventListener("click", handleClick);
      container.removeEventListener("contextmenu", handleContextMenu);
      priceLines.forEach((line) => candleSeries.removePriceLine(line));
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [
    candles,
    chartTradingEnabled,
    closeFillPoints,
    dealPoints,
    height,
    limitLevels,
    onChartTradeIntent,
    openFillPoints,
    referenceLevels,
    stopLossLevels,
    takeProfitLevels,
    theme,
  ]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: `${height}px`,
        cursor: chartTradingEnabled ? "crosshair" : "default",
      }}
    />
  );
}
