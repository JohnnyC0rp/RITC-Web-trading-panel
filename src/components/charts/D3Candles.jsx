import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { getChartPalette } from "./chartPalette";

const pickTickLabels = (candles, maxTicks = 8) => {
  if (candles.length <= maxTicks) return candles.map((candle) => candle.tick);
  const step = Math.ceil(candles.length / maxTicks);
  return candles.filter((_, index) => index % step === 0).map((candle) => candle.tick);
};

export default function D3Candles({
  candles,
  dealPoints,
  openFillPoints,
  closeFillPoints,
  limitLevels,
  stopLossLevels,
  takeProfitLevels,
  referenceLevels,
  theme,
  height,
  autoScale = false,
}) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const [manualYDomain, setManualYDomain] = useState(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!wrapRef.current) return undefined;

    const updateSize = () => {
      const nextWidth = wrapRef.current?.clientWidth || 0;
      setWidth(nextWidth);
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!svgRef.current || !width || !candles.length) return;

    const palette = getChartPalette(theme);
    const margin = { top: 20, right: 20, bottom: 30, left: 45 };
    const innerWidth = Math.max(10, width - margin.left - margin.right);
    const innerHeight = Math.max(10, height - margin.top - margin.bottom);

    const ticks = candles.map((candle) => candle.tick);
    const yMin = d3.min(candles, (candle) => candle.low);
    const yMax = d3.max(candles, (candle) => candle.high);
    const yPad = (yMax - yMin || 1) * 0.06;
    const dynamicRange = [yMin - yPad, yMax + yPad];
    const [rangeMin, rangeMax] =
      !autoScale && Array.isArray(manualYDomain) ? manualYDomain : dynamicRange;

    const x = d3
      .scaleBand()
      .domain(ticks)
      .range([margin.left, margin.left + innerWidth])
      .padding(0.28);
    const y = d3
      .scaleLinear()
      .domain([rangeMin, rangeMax])
      .nice()
      .range([margin.top + innerHeight, margin.top]);

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height).style("background", palette.background);

    const yTicks = y.ticks(6);
    svg
      .append("g")
      .attr("class", "d3-grid")
      .selectAll("line")
      .data(yTicks)
      .join("line")
      .attr("x1", margin.left)
      .attr("x2", margin.left + innerWidth)
      .attr("y1", (tick) => y(tick))
      .attr("y2", (tick) => y(tick))
      .attr("stroke", palette.grid)
      .attr("stroke-width", 1);

    const xAxis = d3
      .axisBottom(x)
      .tickValues(pickTickLabels(candles))
      .tickFormat((tick) => String(tick));
    const yAxis = d3.axisLeft(y).ticks(6);

    svg
      .append("g")
      .attr("transform", `translate(0,${margin.top + innerHeight})`)
      .call(xAxis)
      .call((group) => group.selectAll("text").attr("fill", palette.text).attr("font-size", 10))
      .call((group) => group.selectAll("line").attr("stroke", palette.grid))
      .call((group) => group.select("path").attr("stroke", palette.grid));

    svg
      .append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(yAxis)
      .call((group) => group.selectAll("text").attr("fill", palette.text).attr("font-size", 10))
      .call((group) => group.selectAll("line").attr("stroke", palette.grid))
      .call((group) => group.select("path").attr("stroke", palette.grid));

    const levelLines = [
      ...limitLevels.map((level) => ({
        price: level.price,
        label: level.side === "BUY" ? `LMT B x${level.count}` : `LMT S x${level.count}`,
        color: level.side === "BUY" ? "#2563eb" : "#f97316",
        dash: "2,2",
      })),
      ...stopLossLevels.map((level) => ({
        price: level.price,
        label: `SL x${level.count}`,
        color: "#dc2626",
        dash: "4,3",
      })),
      ...takeProfitLevels.map((level) => ({
        price: level.price,
        label: `TP x${level.count}`,
        color: "#16a34a",
        dash: "4,3",
      })),
      ...referenceLevels.map((level) => ({
        price: level.price,
        label: level.label || "Reference",
        color: level.color || "#475569",
        dash:
          level.style === "dot"
            ? "2,2"
            : level.style === "dash"
              ? "4,3"
              : null,
      })),
    ];

    const levelLayer = svg.append("g");
    levelLayer
      .selectAll("line.level")
      .data(levelLines.filter((line) => Number.isFinite(line.price)))
      .join("line")
      .attr("class", "level")
      .attr("x1", margin.left)
      .attr("x2", margin.left + innerWidth)
      .attr("y1", (line) => y(line.price))
      .attr("y2", (line) => y(line.price))
      .attr("stroke", (line) => line.color)
      .attr("stroke-width", 1.1)
      .attr("stroke-dasharray", (line) => line.dash);

    levelLayer
      .selectAll("text.level-label")
      .data(levelLines.filter((line) => Number.isFinite(line.price)))
      .join("text")
      .attr("class", "level-label")
      .attr("x", margin.left + innerWidth - 4)
      .attr("y", (line) => y(line.price) - 2)
      .attr("text-anchor", "end")
      .attr("fill", (line) => line.color)
      .attr("font-size", 9)
      .text((line) => line.label);

    const candleLayer = svg.append("g");

    candleLayer
      .selectAll("line.wick")
      .data(candles)
      .join("line")
      .attr("class", "wick")
      .attr("x1", (candle) => x(candle.tick) + x.bandwidth() / 2)
      .attr("x2", (candle) => x(candle.tick) + x.bandwidth() / 2)
      .attr("y1", (candle) => y(candle.high))
      .attr("y2", (candle) => y(candle.low))
      .attr("stroke", (candle) => (candle.close >= candle.open ? palette.up : palette.down))
      .attr("stroke-width", 1);

    candleLayer
      .selectAll("rect.body")
      .data(candles)
      .join("rect")
      .attr("class", "body")
      .attr("x", (candle) => x(candle.tick))
      .attr("y", (candle) => y(Math.max(candle.open, candle.close)))
      .attr("width", Math.max(2, x.bandwidth()))
      .attr("height", (candle) => Math.max(1, Math.abs(y(candle.open) - y(candle.close))))
      .attr("fill", (candle) => (candle.close >= candle.open ? palette.up : palette.down))
      .attr("opacity", 0.92);

    svg
      .append("g")
      .selectAll("circle.deal")
      .data(dealPoints.filter((point) => ticks.includes(point.tick)))
      .join("circle")
      .attr("class", "deal")
      .attr("cx", (point) => x(point.tick) + x.bandwidth() / 2)
      .attr("cy", (point) => y(point.price))
      .attr("r", 2)
      .attr("fill", palette.deal);

    const triangle = d3.symbol().type(d3.symbolTriangle).size(62);
    const openLayer = svg.append("g");

    openLayer
      .selectAll("path.open")
      .data(openFillPoints.filter((point) => ticks.includes(point.tick)))
      .join("path")
      .attr("class", "open")
      .attr("d", triangle)
      .attr("transform", (point) => {
        const cx = x(point.tick) + x.bandwidth() / 2;
        const cy = y(point.price);
        const rotation = point.side === "BUY" ? 0 : 180;
        return `translate(${cx},${cy}) rotate(${rotation})`;
      })
      .attr("fill", (point) => (point.side === "BUY" ? palette.openBuy : palette.openSell))
      .attr("stroke", palette.border)
      .attr("stroke-width", 0.8);

    svg
      .append("g")
      .selectAll("circle.close")
      .data(closeFillPoints.filter((point) => ticks.includes(point.tick)))
      .join("circle")
      .attr("class", "close")
      .attr("cx", (point) => x(point.tick) + x.bandwidth() / 2)
      .attr("cy", (point) => y(point.price))
      .attr("r", 3.4)
      .attr("fill", (point) => (point.side === "BUY" ? palette.closeBuy : palette.closeSell))
      .attr("stroke", palette.border)
      .attr("stroke-width", 0.8);
  }, [
    candles,
    closeFillPoints,
    dealPoints,
    height,
    limitLevels,
    openFillPoints,
    referenceLevels,
    stopLossLevels,
    takeProfitLevels,
    theme,
    width,
    autoScale,
    manualYDomain,
  ]);

  const handleWheel = (event) => {
    if (autoScale || !candles.length) return;
    const container = wrapRef.current;
    if (!container) return;
    event.preventDefault();

    const margin = { top: 20, right: 20, bottom: 30, left: 45 };
    const innerHeight = Math.max(10, height - margin.top - margin.bottom);
    const rect = container.getBoundingClientRect();
    const y = event.clientY - rect.top;
    if (y < margin.top || y > margin.top + innerHeight) return;

    const yMin = d3.min(candles, (candle) => candle.low);
    const yMax = d3.max(candles, (candle) => candle.high);
    const yPad = (yMax - yMin || 1) * 0.06;
    const dynamicRange = [yMin - yPad, yMax + yPad];
    const currentRange = Array.isArray(manualYDomain) ? manualYDomain : dynamicRange;
    const [currentMin, currentMax] = currentRange;
    const ratio = 1 - (y - margin.top) / innerHeight;
    const pivot = currentMin + ratio * (currentMax - currentMin);
    const zoom = event.deltaY > 0 ? 1.1 : 0.9;
    const nextMin = pivot + (currentMin - pivot) * zoom;
    const nextMax = pivot + (currentMax - pivot) * zoom;
    if (!Number.isFinite(nextMin) || !Number.isFinite(nextMax) || nextMax <= nextMin) return;
    setManualYDomain([nextMin, nextMax]);
  };

  return (
    <div
      ref={wrapRef}
      style={{ width: "100%", height: `${height}px` }}
      onWheel={handleWheel}
      onDoubleClick={() => setManualYDomain(null)}
    >
      <svg ref={svgRef} />
    </div>
  );
}
