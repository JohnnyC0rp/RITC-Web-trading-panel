import { useMemo } from "react";
import Highcharts from "highcharts/highstock";
import HighchartsReact from "highcharts-react-official";
import { getChartPalette } from "./chartPalette";

const toPoint = (point) => [point.tick, point.price];

export default function HighchartsCandles({
  candles,
  dealPoints,
  openFillPoints,
  closeFillPoints,
  showRangeSlider,
  theme,
  height,
}) {
  const options = useMemo(() => {
    const palette = getChartPalette(theme);
    const openBuys = openFillPoints.filter((point) => point.side === "BUY");
    const openSells = openFillPoints.filter((point) => point.side === "SELL");
    const closeBuys = closeFillPoints.filter((point) => point.side === "BUY");
    const closeSells = closeFillPoints.filter((point) => point.side === "SELL");

    return {
      chart: {
        height,
        backgroundColor: "transparent",
        panning: { enabled: true, type: "x" },
        zooming: { mouseWheel: { enabled: true }, type: "x" },
      },
      title: { text: null },
      credits: { enabled: false },
      accessibility: { enabled: false },
      rangeSelector: { enabled: false },
      navigator: {
        enabled: showRangeSlider,
      },
      scrollbar: {
        enabled: showRangeSlider,
      },
      legend: {
        enabled: true,
        itemStyle: { color: palette.text },
        itemHiddenStyle: { color: palette.border },
      },
      xAxis: {
        lineColor: palette.grid,
        tickColor: palette.grid,
        labels: { style: { color: palette.text, fontSize: "10px" } },
      },
      yAxis: {
        title: { text: "Price", style: { color: palette.text } },
        gridLineColor: palette.grid,
        labels: { style: { color: palette.text, fontSize: "10px" } },
      },
      tooltip: {
        split: false,
        shared: true,
      },
      plotOptions: {
        series: {
          animation: false,
          turboThreshold: 0,
        },
      },
      series: [
        {
          type: "candlestick",
          name: "Candles",
          data: candles.map((candle) => [
            candle.tick,
            candle.open,
            candle.high,
            candle.low,
            candle.close,
          ]),
          color: palette.down,
          upColor: palette.up,
          lineColor: palette.down,
          upLineColor: palette.up,
        },
        ...(dealPoints.length
          ? [
              {
                type: "scatter",
                name: "Deals",
                data: dealPoints.map(toPoint),
                color: palette.deal,
                marker: { radius: 2.8 },
              },
            ]
          : []),
        ...(openBuys.length
          ? [
              {
                type: "scatter",
                name: "Open Buy",
                data: openBuys.map(toPoint),
                color: palette.openBuy,
                marker: { symbol: "triangle", radius: 5 },
              },
            ]
          : []),
        ...(openSells.length
          ? [
              {
                type: "scatter",
                name: "Open Sell",
                data: openSells.map(toPoint),
                color: palette.openSell,
                marker: { symbol: "triangle-down", radius: 5 },
              },
            ]
          : []),
        ...(closeBuys.length
          ? [
              {
                type: "scatter",
                name: "Close Buy",
                data: closeBuys.map(toPoint),
                color: palette.closeBuy,
                marker: { symbol: "circle", radius: 4 },
              },
            ]
          : []),
        ...(closeSells.length
          ? [
              {
                type: "scatter",
                name: "Close Sell",
                data: closeSells.map(toPoint),
                color: palette.closeSell,
                marker: { symbol: "circle", radius: 4 },
              },
            ]
          : []),
      ],
    };
  }, [candles, closeFillPoints, dealPoints, height, openFillPoints, showRangeSlider, theme]);

  return (
    <HighchartsReact
      highcharts={Highcharts}
      constructorType="stockChart"
      options={options}
      immutable
    />
  );
}
