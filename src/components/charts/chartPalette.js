export const getChartPalette = (theme) => {
  if (theme === "dark") {
    return {
      background: "#ffffff",
      grid: "rgba(148, 163, 184, 0.2)",
      text: "#0f172a",
      up: "#34d399",
      down: "#f87171",
      deal: "rgba(148, 163, 184, 0.65)",
      openBuy: "#22c55e",
      openSell: "#ef4444",
      closeBuy: "#86efac",
      closeSell: "#fca5a5",
      border: "rgba(15, 23, 42, 0.35)",
    };
  }

  return {
    background: "#ffffff",
    grid: "rgba(15, 23, 42, 0.12)",
    text: "#0f172a",
    up: "#2e8b57",
    down: "#c0392b",
    deal: "rgba(100, 116, 139, 0.7)",
    openBuy: "#16a34a",
    openSell: "#dc2626",
    closeBuy: "#4ade80",
    closeSell: "#f87171",
    border: "rgba(15, 23, 42, 0.15)",
  };
};
