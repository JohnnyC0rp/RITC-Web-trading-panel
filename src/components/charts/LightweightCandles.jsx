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
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const priceLinesRef = useRef([]);
  const didInitialFitRef = useRef(false);
  const chartTradeIntentRef = useRef(onChartTradeIntent);
  const latestThemeRef = useRef(theme);
  const latestHeightRef = useRef(height);

  useEffect(() => {
    chartTradeIntentRef.current = onChartTradeIntent;
  }, [onChartTradeIntent]);

  useEffect(() => {
    latestThemeRef.current = theme;
    latestHeightRef.current = height;
  }, [height, theme]);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const palette = getChartPalette(latestThemeRef.current);
    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: latestHeightRef.current,
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
        autoScale: false,
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
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: {
          time: true,
          price: true,
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: palette.up,
      downColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
      borderVisible: false,
    });
    candleSeries.priceScale().applyOptions({ autoScale: false });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    const toPrice = (clientY) => {
      const rect = container.getBoundingClientRect();
      const y = clientY - rect.top;
      const numeric = candleSeries.coordinateToPrice(y);
      return Number.isFinite(Number(numeric)) ? Number(numeric) : null;
    };

    const handleClick = (event) => {
      const callback = chartTradeIntentRef.current;
      if (!callback) return;
      const clickedPrice = toPrice(event.clientY);
      if (clickedPrice == null) return;
      callback("left", clickedPrice);
    };

    const handleContextMenu = (event) => {
      const callback = chartTradeIntentRef.current;
      if (!callback) return;
      event.preventDefault();
      const clickedPrice = toPrice(event.clientY);
      if (clickedPrice == null) return;
      callback("right", clickedPrice);
    };

    container.addEventListener("click", handleClick);
    container.addEventListener("contextmenu", handleContextMenu);

    const resizeObserver = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect?.width;
      if (!nextWidth) return;
      chart.applyOptions({ width: nextWidth, height: latestHeightRef.current });
    });
    resizeObserver.observe(container);

    return () => {
      container.removeEventListener("click", handleClick);
      container.removeEventListener("contextmenu", handleContextMenu);
      resizeObserver.disconnect();
      priceLinesRef.current.forEach((line) => candleSeries.removePriceLine(line));
      priceLinesRef.current = [];
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      didInitialFitRef.current = false;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries) return;

    const palette = getChartPalette(theme);
    chart.applyOptions({
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
        autoScale: false,
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
    candleSeries.applyOptions({
      upColor: palette.up,
      downColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
      borderVisible: false,
    });
    candleSeries.priceScale().applyOptions({ autoScale: false });
  }, [height, theme]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries) return;

    const palette = getChartPalette(theme);

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
            size: 2,
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

    priceLinesRef.current.forEach((line) => candleSeries.removePriceLine(line));
    priceLinesRef.current = [];

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

    priceLinesRef.current = [
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

    if (!didInitialFitRef.current && candleSeriesData.length) {
      // Fit once on initial load, then keep hands off so manual zoom/scale survives updates.
      chart.timeScale().fitContent();
      didInitialFitRef.current = true;
    }
  }, [
    candles,
    closeFillPoints,
    dealPoints,
    limitLevels,
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
