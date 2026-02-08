import { useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";
import { getChartPalette } from "./chartPalette";

const TIME_BASE = 1_700_000_000;
const STEP_SECONDS = 60;

export default function LightweightCandles({
  candles,
  openFillPoints,
  closeFillPoints,
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
    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect?.width;
      if (!nextWidth) return;
      chart.applyOptions({ width: nextWidth, height });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [candles, closeFillPoints, height, openFillPoints, theme]);

  return <div ref={containerRef} style={{ width: "100%", height: `${height}px` }} />;
}
