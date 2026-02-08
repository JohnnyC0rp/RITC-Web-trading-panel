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
      ...dealPoints
        .map((deal) => {
          const time = tickToTime.get(deal.tick);
          if (!time) return null;
          return {
            time,
            position: "inBar",
            color: palette.deal,
            shape: "circle",
            text: "DEAL",
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
    ];

    candleSeries.setMarkers(markerData);

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
    ];

    chart.timeScale().fitContent();

    const toPrice = (clientY) => {
      const rect = container.getBoundingClientRect();
      const y = clientY - rect.top;
      const numeric = candleSeries.coordinateToPrice(y);
      return Number.isFinite(Number(numeric)) ? Number(numeric) : null;
    };

    const handleClick = (event) => {
      if (!chartTradingEnabled || !onChartTradeIntent) return;
      const clickedPrice = toPrice(event.clientY);
      if (clickedPrice == null) return;
      onChartTradeIntent("left", clickedPrice);
    };

    const handleContextMenu = (event) => {
      if (!chartTradingEnabled || !onChartTradeIntent) return;
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
    stopLossLevels,
    takeProfitLevels,
    theme,
  ]);

  return <div ref={containerRef} style={{ width: "100%", height: `${height}px` }} />;
}
