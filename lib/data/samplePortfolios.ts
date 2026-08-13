import type { PortfolioHolding } from "@/types/domain";

/**
 * Preset dummy portfolios so the dashboard is useful on first load.
 *
 * These are illustrative baskets of public large caps, chosen to produce
 * *visibly different* factor signatures — a growth book and a dividend book
 * should not look alike on the radar, or the chart is not proving anything.
 * Zero confidential data (CLAUDE.md): nothing here reflects any real mandate.
 */

export interface SamplePortfolio {
  id: string;
  name: string;
  /** One line on what the basket is meant to express. */
  thesis: string;
  /** The factor tilt a user should expect to see. Sets up a falsifiable read. */
  expectedTilt: string;
  benchmark: string;
  holdings: PortfolioHolding[];
}

export const SAMPLE_PORTFOLIOS: readonly SamplePortfolio[] = [
  {
    id: "tech-giant-focus",
    name: "Tech Giant Focus",
    thesis: "Concentrated US mega-cap technology and platform names.",
    expectedTilt: "Growth (negative Value), high Market beta, negative Low Vol",
    benchmark: "SPY",
    holdings: [
      { ticker: "NVDA", weight: 0.2 },
      { ticker: "MSFT", weight: 0.18 },
      { ticker: "AAPL", weight: 0.17 },
      { ticker: "GOOGL", weight: 0.13 },
      { ticker: "AMZN", weight: 0.12 },
      { ticker: "META", weight: 0.1 },
      { ticker: "AVGO", weight: 0.1 },
    ],
  },
  {
    id: "quality-dividend",
    name: "Quality Dividend Portfolio",
    thesis: "Cash-generative defensives with long dividend records.",
    expectedTilt: "Positive Quality and Low Vol, positive Value, sub-1 Market beta",
    benchmark: "SPY",
    holdings: [
      { ticker: "JNJ", weight: 0.14 },
      { ticker: "PG", weight: 0.14 },
      { ticker: "KO", weight: 0.12 },
      { ticker: "PEP", weight: 0.12 },
      { ticker: "MRK", weight: 0.12 },
      { ticker: "CVX", weight: 0.12 },
      { ticker: "MCD", weight: 0.12 },
      { ticker: "MMM", weight: 0.12 },
    ],
  },
  {
    id: "us-value-cyclical",
    name: "US Value & Cyclicals",
    thesis: "Financials, energy and industrials trading on book and earnings.",
    expectedTilt: "Strongly positive Value, negative Momentum",
    benchmark: "SPY",
    holdings: [
      { ticker: "JPM", weight: 0.15 },
      { ticker: "BAC", weight: 0.12 },
      { ticker: "XOM", weight: 0.14 },
      { ticker: "CVX", weight: 0.12 },
      { ticker: "CAT", weight: 0.12 },
      { ticker: "DE", weight: 0.1 },
      { ticker: "GS", weight: 0.13 },
      { ticker: "F", weight: 0.12 },
    ],
  },
  {
    id: "kospi-core",
    name: "KOSPI 200 Core",
    thesis: "Korean large caps: semiconductors, batteries, autos, platforms.",
    expectedTilt: "Factor betas are measured against US factors — see the warning",
    benchmark: "^KS11",
    holdings: [
      { ticker: "005930.KS", weight: 0.3 },
      { ticker: "000660.KS", weight: 0.15 },
      { ticker: "373220.KS", weight: 0.1 },
      { ticker: "207940.KS", weight: 0.1 },
      { ticker: "005380.KS", weight: 0.1 },
      { ticker: "035420.KS", weight: 0.1 },
      { ticker: "051910.KS", weight: 0.075 },
      { ticker: "006400.KS", weight: 0.075 },
    ],
  },
];

export interface BenchmarkOption {
  ticker: string;
  label: string;
  region: "US" | "KR";
}

export const BENCHMARKS: readonly BenchmarkOption[] = [
  { ticker: "SPY", label: "S&P 500 (SPY)", region: "US" },
  { ticker: "^GSPC", label: "S&P 500 Index (^GSPC)", region: "US" },
  { ticker: "IWM", label: "Russell 2000 (IWM)", region: "US" },
  { ticker: "^KS11", label: "KOSPI Composite (^KS11)", region: "KR" },
  { ticker: "069500.KS", label: "KOSPI 200 (KODEX 200)", region: "KR" },
];

export interface RangePreset {
  id: string;
  label: string;
  /** Years back from today; null means "since factor history starts". */
  years: number | null;
}

export const RANGE_PRESETS: readonly RangePreset[] = [
  { id: "1y", label: "1Y", years: 1 },
  { id: "3y", label: "3Y", years: 3 },
  { id: "5y", label: "5Y", years: 5 },
  { id: "max", label: "MAX", years: null },
];
