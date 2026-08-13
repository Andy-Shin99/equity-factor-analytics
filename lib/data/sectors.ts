import type { PortfolioHolding } from "@/types/domain";

/**
 * Sector classification and benchmark sector weights.
 *
 * ============================ READ THIS ============================
 * This is a STATIC REFERENCE FILE, not collected data. Neither piece is
 * available anywhere else in the project:
 *
 *   1. Sector membership. `daily_prices` stores prices only. Yahoo exposes a
 *      sector via `quoteSummary/assetProfile`, but that is a second endpoint and
 *      a second cache table, so it is out of scope here. The map below covers the
 *      sample portfolios' universe; anything else falls to "Unclassified" and is
 *      reported as such rather than silently bucketed.
 *
 *   2. Benchmark sector weights. Deriving these needs index CONSTITUENT weights,
 *      which this project does not hold at all — an ETF's price series says
 *      nothing about what is inside it. The numbers below are approximate
 *      published weights, hand-entered, and they drift every month.
 *
 * So: sector active exposure is directional, not decision-grade, and the UI says
 * so. Stock-level active weight is NOT offered, because that would need
 * constituent weights and inventing them would be worse than omitting them.
 * ===================================================================
 */

/** Update this when the weights below are refreshed. Rendered in the UI. */
export const BENCHMARK_WEIGHTS_AS_OF = "2026-06-30";

export const SECTORS = [
  "Information Technology",
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Health Care",
  "Financials",
  "Industrials",
  "Energy",
  "Materials",
  "Utilities",
  "Real Estate",
  "Unclassified",
] as const;

export type Sector = (typeof SECTORS)[number];

const SECTOR_BY_TICKER: Record<string, Sector> = {
  // --- US information technology
  AAPL: "Information Technology",
  MSFT: "Information Technology",
  NVDA: "Information Technology",
  AVGO: "Information Technology",
  AMD: "Information Technology",
  CRM: "Information Technology",
  ORCL: "Information Technology",
  // --- US communication services
  GOOGL: "Communication Services",
  GOOG: "Communication Services",
  META: "Communication Services",
  NFLX: "Communication Services",
  DIS: "Communication Services",
  // --- US consumer discretionary
  AMZN: "Consumer Discretionary",
  TSLA: "Consumer Discretionary",
  HD: "Consumer Discretionary",
  MCD: "Consumer Discretionary",
  NKE: "Consumer Discretionary",
  F: "Consumer Discretionary",
  // --- US consumer staples
  PG: "Consumer Staples",
  KO: "Consumer Staples",
  PEP: "Consumer Staples",
  WMT: "Consumer Staples",
  COST: "Consumer Staples",
  // --- US health care
  JNJ: "Health Care",
  MRK: "Health Care",
  PFE: "Health Care",
  UNH: "Health Care",
  LLY: "Health Care",
  ABBV: "Health Care",
  // --- US financials
  JPM: "Financials",
  BAC: "Financials",
  GS: "Financials",
  WFC: "Financials",
  MS: "Financials",
  "BRK-B": "Financials",
  V: "Financials",
  MA: "Financials",
  // --- US industrials
  CAT: "Industrials",
  DE: "Industrials",
  MMM: "Industrials",
  BA: "Industrials",
  HON: "Industrials",
  UPS: "Industrials",
  // --- US energy
  XOM: "Energy",
  CVX: "Energy",
  COP: "Energy",
  // --- US materials / utilities / real estate
  LIN: "Materials",
  NEM: "Materials",
  NEE: "Utilities",
  DUK: "Utilities",
  AMT: "Real Estate",
  PLD: "Real Estate",

  // --- KOSPI large caps
  "005930.KS": "Information Technology", // Samsung Electronics
  "000660.KS": "Information Technology", // SK hynix
  "006400.KS": "Information Technology", // Samsung SDI
  "373220.KS": "Industrials", // LG Energy Solution
  "207940.KS": "Health Care", // Samsung Biologics
  "005380.KS": "Consumer Discretionary", // Hyundai Motor
  "000270.KS": "Consumer Discretionary", // Kia
  "035420.KS": "Communication Services", // NAVER
  "035720.KS": "Communication Services", // Kakao
  "051910.KS": "Materials", // LG Chem
  "005490.KS": "Materials", // POSCO Holdings
  "105560.KS": "Financials", // KB Financial
  "055550.KS": "Financials", // Shinhan Financial
};

export function sectorOf(ticker: string): Sector {
  return SECTOR_BY_TICKER[ticker.toUpperCase()] ?? "Unclassified";
}

/**
 * Approximate S&P 500 GICS sector weights. Hand-entered from published index
 * data; see the file header. Sums to 1.0 by construction.
 */
const SP500_SECTOR_WEIGHTS: Partial<Record<Sector, number>> = {
  "Information Technology": 0.34,
  "Financials": 0.14,
  "Consumer Discretionary": 0.105,
  "Communication Services": 0.1,
  "Health Care": 0.09,
  "Industrials": 0.075,
  "Consumer Staples": 0.055,
  "Energy": 0.03,
  "Utilities": 0.025,
  "Materials": 0.02,
  "Real Estate": 0.02,
};

/**
 * Approximate KOSPI 200 sector weights. Far more concentrated in tech than the
 * S&P 500 — Samsung Electronics alone is roughly a fifth of the index.
 */
const KOSPI200_SECTOR_WEIGHTS: Partial<Record<Sector, number>> = {
  "Information Technology": 0.42,
  "Industrials": 0.14,
  "Consumer Discretionary": 0.12,
  "Financials": 0.11,
  "Materials": 0.08,
  "Health Care": 0.07,
  "Communication Services": 0.05,
  "Consumer Staples": 0.03,
  "Energy": 0.01,
  "Utilities": 0.01,
};

/** Which static weight set applies to a benchmark ticker, if any. */
export function benchmarkSectorWeights(
  benchmark: string,
): { weights: Partial<Record<Sector, number>>; label: string } | null {
  const ticker = benchmark.toUpperCase();
  if (ticker === "SPY" || ticker === "^GSPC" || ticker === "VOO" || ticker === "IVV") {
    return { weights: SP500_SECTOR_WEIGHTS, label: "S&P 500 (approx.)" };
  }
  if (ticker === "^KS11" || ticker === "069500.KS" || ticker === "102110.KS") {
    return { weights: KOSPI200_SECTOR_WEIGHTS, label: "KOSPI 200 (approx.)" };
  }
  // IWM, sector ETFs, single stocks: no reference weights, so no comparison is
  // shown rather than a misleading one against the wrong index.
  return null;
}

export interface SectorExposure {
  sector: Sector;
  portfolioWeight: number;
  /** Null when no reference weights exist for the selected benchmark. */
  benchmarkWeight: number | null;
  /** portfolio - benchmark, null when there is nothing to compare against. */
  activeWeight: number | null;
  tickers: string[];
}

export interface SectorExposureResult {
  rows: SectorExposure[];
  benchmarkLabel: string | null;
  /** Share of portfolio weight that could be classified at all. */
  classifiedWeight: number;
  unclassifiedTickers: string[];
}

/**
 * Roll holdings up to sector level and difference against the benchmark.
 *
 * Sectors present in either the portfolio or the benchmark are returned, so a
 * zero-weight sector the benchmark holds still shows as a negative active
 * exposure — an omission is a position.
 */
export function computeSectorExposure(
  holdings: readonly PortfolioHolding[],
  benchmark: string,
): SectorExposureResult {
  const reference = benchmarkSectorWeights(benchmark);

  const portfolioBySector = new Map<Sector, { weight: number; tickers: string[] }>();
  const unclassifiedTickers: string[] = [];
  let classifiedWeight = 0;

  for (const holding of holdings) {
    const sector = sectorOf(holding.ticker);
    if (sector === "Unclassified") unclassifiedTickers.push(holding.ticker);
    else classifiedWeight += holding.weight;

    const entry = portfolioBySector.get(sector) ?? { weight: 0, tickers: [] };
    entry.weight += holding.weight;
    entry.tickers.push(holding.ticker);
    portfolioBySector.set(sector, entry);
  }

  const sectorsInPlay = new Set<Sector>([
    ...portfolioBySector.keys(),
    ...((reference ? Object.keys(reference.weights) : []) as Sector[]),
  ]);

  const rows: SectorExposure[] = SECTORS.filter((sector) => sectorsInPlay.has(sector)).map(
    (sector) => {
      const portfolioWeight = portfolioBySector.get(sector)?.weight ?? 0;
      const benchmarkWeight = reference ? (reference.weights[sector] ?? 0) : null;
      return {
        sector,
        portfolioWeight,
        benchmarkWeight,
        activeWeight: benchmarkWeight === null ? null : portfolioWeight - benchmarkWeight,
        tickers: portfolioBySector.get(sector)?.tickers ?? [],
      };
    },
  );

  // Largest absolute active bet first; that is the row a PM looks for.
  rows.sort((a, b) => {
    const aKey = a.activeWeight === null ? a.portfolioWeight : Math.abs(a.activeWeight);
    const bKey = b.activeWeight === null ? b.portfolioWeight : Math.abs(b.activeWeight);
    return bKey - aKey;
  });

  return {
    rows,
    benchmarkLabel: reference?.label ?? null,
    classifiedWeight,
    unclassifiedTickers,
  };
}
