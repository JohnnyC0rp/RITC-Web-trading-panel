/**
 * M&A pair metadata for RITC 2026 Merger Arbitrage case.
 * Search anchors:
 * - "cashComponent" / "stockRatio" for deal math
 * - "description" for UI summary copy
 */
export const MNA_CASE_PAIRS = [
  {
    id: "tgx-phr",
    label: "TGX / PHR",
    targetTicker: "TGX",
    acquirerTicker: "PHR",
    sector: "Pharmaceuticals",
    structureLabel: "All-cash: $50.00 per TGX",
    description:
      "Healthcare acquisition where PHR buys TGX for cash, so TGX should converge toward the $50.00 deal value.",
    cashComponent: 50,
    stockRatio: 0,
  },
  {
    id: "byl-cld",
    label: "BYL / CLD",
    targetTicker: "BYL",
    acquirerTicker: "CLD",
    sector: "Cloud Software",
    structureLabel: "Stock-for-stock: 0.75 CLD per BYL",
    description:
      "Tech merger where BYL holders receive CLD stock; BYL fair value tracks CLD with a 0.75 conversion ratio.",
    cashComponent: 0,
    stockRatio: 0.75,
  },
  {
    id: "ggd-pnr",
    label: "GGD / PNR",
    targetTicker: "GGD",
    acquirerTicker: "PNR",
    sector: "Energy / Infrastructure",
    structureLabel: "Mixed: $33.00 + 0.20 PNR per GGD",
    description:
      "Energy-infrastructure combination with cash plus stock consideration, making GGD fair value partly fixed and partly PNR-driven.",
    cashComponent: 33,
    stockRatio: 0.2,
  },
  {
    id: "fsr-atb",
    label: "FSR / ATB",
    targetTicker: "FSR",
    acquirerTicker: "ATB",
    sector: "Banking",
    structureLabel: "All-cash: $40.00 per FSR",
    description:
      "Banking consolidation where ATB acquires FSR in cash, so FSR spread is mostly timing and completion-risk driven.",
    cashComponent: 40,
    stockRatio: 0,
  },
  {
    id: "spk-eec",
    label: "SPK / EEC",
    targetTicker: "SPK",
    acquirerTicker: "EEC",
    sector: "Renewable Energy",
    structureLabel: "Stock-for-stock: 1.20 EEC per SPK",
    description:
      "Renewables tie-up where SPK converts into EEC shares; SPK fair value should mirror EEC through the 1.20 exchange ratio.",
    cashComponent: 0,
    stockRatio: 1.2,
  },
];

export const MNA_DEFAULT_PAIR_IDS = MNA_CASE_PAIRS.slice(0, 2).map((pair) => pair.id);
export const MNA_CASE_PAIR_IDS = new Set(MNA_CASE_PAIRS.map((pair) => pair.id));
export const MNA_CASE_PAIR_BY_ID = new Map(MNA_CASE_PAIRS.map((pair) => [pair.id, pair]));

export const sanitizeMnaPairIds = (rawIds) => {
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return [...MNA_DEFAULT_PAIR_IDS];
  }
  const next = [];
  const seen = new Set();
  rawIds.forEach((candidate) => {
    if (!MNA_CASE_PAIR_IDS.has(candidate)) return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    next.push(candidate);
  });
  if (!next.length) return [...MNA_DEFAULT_PAIR_IDS];
  return next;
};

export const deriveMnaTargetPrice = (pair, acquirerPrice) => {
  if (!pair) return null;
  const cash = Number(pair.cashComponent ?? 0);
  const ratio = Number(pair.stockRatio ?? 0);
  if (ratio > 0) {
    const peer = Number(acquirerPrice);
    if (!Number.isFinite(peer)) return null;
    return Number((cash + ratio * peer).toFixed(4));
  }
  return Number.isFinite(cash) ? Number(cash.toFixed(4)) : null;
};
