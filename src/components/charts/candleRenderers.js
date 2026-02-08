export const CANDLE_RENDERERS = [
  {
    id: "lightweight",
    label: "Lightweight Charts",
    description: "Fast canvas rendering focused on execution speed.",
    supportsIndicators: false,
    supportsRangeSlider: false,
  },
  {
    id: "plotly",
    label: "Plotly",
    description: "Full feature set with indicators and viewport memory.",
    supportsIndicators: true,
    supportsRangeSlider: true,
  },
  {
    id: "echarts",
    label: "ECharts",
    description: "Rich interactions with efficient pan and zoom.",
    supportsIndicators: false,
    supportsRangeSlider: true,
  },
  {
    id: "highcharts",
    label: "Highcharts",
    description: "Stock-chart style navigator and polished defaults.",
    supportsIndicators: false,
    supportsRangeSlider: true,
  },
  {
    id: "d3",
    label: "D3",
    description: "Custom SVG candlesticks with no black-box charting.",
    supportsIndicators: false,
    supportsRangeSlider: false,
  },
];

export const DEFAULT_CANDLE_RENDERER = CANDLE_RENDERERS[0].id;

export const isKnownCandleRenderer = (value) =>
  CANDLE_RENDERERS.some((renderer) => renderer.id === value);

export const getCandleRendererMeta = (value) =>
  CANDLE_RENDERERS.find((renderer) => renderer.id === value) || CANDLE_RENDERERS[0];
