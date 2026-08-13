/**
 * Domain types consumed by the quant engine and the UI.
 * Mapped from the raw row types in types/database.ts at the data-access boundary.
 */

/** The factor columns available in `factor_returns`, in canonical order. */
export const FACTOR_KEYS = [
  "market_rf",
  "smb",
  "hml",
  "quality",
  "momentum",
  "low_vol",
] as const;

export type FactorKey = (typeof FACTOR_KEYS)[number];

/**
 * The five style axes of the exposure radar, in the order DESIGN.md lists them.
 * Market is deliberately excluded — market beta is a level, not a style tilt.
 */
export const STYLE_FACTOR_KEYS = [
  "hml",
  "momentum",
  "quality",
  "low_vol",
  "smb",
] as const satisfies readonly FactorKey[];

export type StyleFactorKey = (typeof STYLE_FACTOR_KEYS)[number];

/** Human labels for the factor axes (DESIGN.md). */
export const FACTOR_LABELS: Record<FactorKey, string> = {
  market_rf: "Market",
  smb: "Size",
  hml: "Value",
  quality: "Quality",
  momentum: "Momentum",
  low_vol: "Low Vol",
};

export interface PortfolioHolding {
  ticker: string;
  /** Decimal fraction. The full set is expected to sum to 1 within tolerance. */
  weight: number;
}

export interface Portfolio {
  id: string;
  userId: string | null;
  name: string;
  holdings: PortfolioHolding[];
  createdAt: string;
}

/** A single asset's adjusted close on a given date. */
export interface PriceBar {
  ticker: string;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  adjClose: number;
  volume: number | null;
}

/** One complete observation of the regression's right-hand side. */
export interface FactorObservation {
  date: string;
  values: Record<FactorKey, number>;
}

/** A date-aligned return series. `dates[i]` corresponds to `values[i]`. */
export interface ReturnSeries {
  dates: string[];
  /** Simple daily returns as decimal fractions. */
  values: number[];
}

/** Inclusive ISO date range, `YYYY-MM-DD`. */
export interface DateRange {
  from: string;
  to: string;
}
