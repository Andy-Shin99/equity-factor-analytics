import type { FactorKey } from "@/types/domain";

/**
 * How each factor return is constructed.
 *
 * WHY ETF PROXIES, NOT THE FAMA-FRENCH DATA LIBRARY
 *
 * The academic factors from Ken French's library are the reference standard for
 * Market/SMB/HML, but they do not publish Quality or Low Volatility factors at
 * all (FF5 offers RMW and CMA instead), and DESIGN.md requires a five-axis style
 * radar including Low Vol. Long-short spreads of liquid factor ETFs cover all
 * six axes from a single data source that this project already reads.
 *
 * WHAT THIS COSTS
 *
 * These are TRADEABLE proxies, not academic factors. Each leg carries an expense
 * ratio, index-construction choices, and tracking difference, so a beta measured
 * against them is a beta against an investable implementation of the style —
 * arguably what a PM actually wants, but NOT numerically comparable to a
 * published Fama-French beta. Surface the provenance wherever betas are shown.
 *
 * All legs are US-listed and share the NYSE calendar, so date alignment is clean.
 */

export interface FactorDefinition {
  key: FactorKey;
  label: string;
  /** Long leg ticker. */
  long: string;
  /** Short leg ticker. The factor return is long minus short. */
  short: string;
  /** Shown in the UI to explain what the exposure means. */
  description: string;
}

/**
 * Daily risk-free rate proxy: the total return of a 1-3 month T-bill ETF.
 * Its adjusted close includes distributions, so the daily return approximates
 * the short rate accrual.
 */
export const RISK_FREE_PROXY = "BIL";

export const FACTOR_DEFINITIONS: readonly FactorDefinition[] = [
  {
    key: "market_rf",
    label: "Market",
    long: "SPY",
    short: RISK_FREE_PROXY,
    description: "Excess return of the S&P 500 over the short rate (SPY - BIL).",
  },
  {
    key: "smb",
    label: "Size",
    long: "IWM",
    short: "SPY",
    description: "Small minus big: Russell 2000 over the S&P 500 (IWM - SPY).",
  },
  {
    key: "hml",
    label: "Value",
    long: "VTV",
    short: "VUG",
    description: "Value minus growth, large-cap US (VTV - VUG).",
  },
  {
    key: "quality",
    label: "Quality",
    long: "QUAL",
    short: "SPY",
    description: "Quality tilt over the market (QUAL - SPY).",
  },
  {
    key: "momentum",
    label: "Momentum",
    long: "MTUM",
    short: "SPY",
    description: "Momentum tilt over the market (MTUM - SPY).",
  },
  {
    key: "low_vol",
    label: "Low Vol",
    long: "USMV",
    short: "SPY",
    description: "Minimum volatility tilt over the market (USMV - SPY).",
  },
];

/** Every ticker the backfill must price, deduplicated. */
export const REQUIRED_TICKERS: readonly string[] = [
  ...new Set(FACTOR_DEFINITIONS.flatMap((d) => [d.long, d.short])),
];

/**
 * Earliest date the full set is available. USMV and QUAL both launched in 2013,
 * so a request for earlier history yields rows that silently omit those factors.
 */
export const FACTOR_HISTORY_START = "2013-09-01";
