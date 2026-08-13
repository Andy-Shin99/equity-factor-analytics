import type { ReturnSeries } from "@/types/domain";

import { activeReturns, wealthIndex } from "./returns";

/**
 * Risk and tracking metrics, implemented to the formulas in
 * .claude/skills/equity-factor-quant-skills/SKILL.md.
 *
 * Annualisation convention, applied consistently so ratios stay dimensionally
 * coherent: returns scale by 252, volatilities by sqrt(252). Mixing an
 * arithmetic annualised numerator with a geometric one inside a ratio is a
 * common way to produce an information ratio that is wrong by several percent,
 * so the geometric variants are provided separately and never used in ratios.
 */

export const TRADING_DAYS_PER_YEAR = 252;

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error("mean of an empty series is undefined");
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** Sample variance with the (N-1) denominator used throughout SKILL.md. */
export function sampleVariance(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) {
    throw new Error(`Sample variance needs at least 2 observations, got ${n}`);
  }
  const average = mean(values);
  let sumSquares = 0;
  for (const value of values) sumSquares += (value - average) ** 2;
  return sumSquares / (n - 1);
}

export function sampleStandardDeviation(values: readonly number[]): number {
  return Math.sqrt(sampleVariance(values));
}

/** Arithmetic annualisation: mean daily return x 252. */
export function annualizedReturn(dailyReturns: readonly number[]): number {
  return mean(dailyReturns) * TRADING_DAYS_PER_YEAR;
}

/** Annualised volatility: sample sigma x sqrt(252). */
export function annualizedVolatility(dailyReturns: readonly number[]): number {
  return sampleStandardDeviation(dailyReturns) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/** Total compounded return over the sample, prod(1 + r) - 1. */
export function cumulativeReturn(dailyReturns: readonly number[]): number {
  let wealth = 1;
  for (const r of dailyReturns) wealth *= 1 + r;
  return wealth - 1;
}

/**
 * Geometric (CAGR) annualisation. Reported to users as the realised return;
 * deliberately NOT used as the numerator of a ratio whose denominator is an
 * arithmetic-annualised volatility.
 */
export function annualizedGeometricReturn(dailyReturns: readonly number[]): number {
  const n = dailyReturns.length;
  if (n === 0) throw new Error("Cannot annualise an empty series");
  const growth = 1 + cumulativeReturn(dailyReturns);
  // A total wipeout has no real-valued CAGR.
  if (growth <= 0) return -1;
  return growth ** (TRADING_DAYS_PER_YEAR / n) - 1;
}

/**
 * Tracking Error.
 *
 *   TE = sqrt( 1/(N-1) * SUM (Rp,t - Rb,t - Dbar)^2 ) * sqrt(252)
 *
 * i.e. the annualised sample standard deviation of the active return series.
 * Note the mean-deviation term: this is the volatility of active return, not the
 * root-mean-square of it. Dropping Dbar inflates TE whenever a portfolio has
 * persistent outperformance, which in turn understates the information ratio.
 */
export function trackingError(portfolio: ReturnSeries, benchmark: ReturnSeries): number {
  return trackingErrorFromActive(activeReturns(portfolio, benchmark).values);
}

export function trackingErrorFromActive(active: readonly number[]): number {
  return sampleStandardDeviation(active) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * Information Ratio = annualised active return / tracking error.
 *
 * Returns NaN when tracking error is zero — a portfolio that never deviates from
 * its benchmark has an undefined IR, not an infinite one.
 */
export function informationRatio(
  portfolio: ReturnSeries,
  benchmark: ReturnSeries,
): number {
  return informationRatioFromActive(activeReturns(portfolio, benchmark).values);
}

export function informationRatioFromActive(active: readonly number[]): number {
  const te = trackingErrorFromActive(active);
  if (!(te > 0)) return Number.NaN;
  return annualizedReturn(active) / te;
}

/** Sharpe ratio against a constant daily risk-free rate. */
export function sharpeRatio(
  dailyReturns: readonly number[],
  dailyRiskFree = 0,
): number {
  const excess = dailyReturns.map((r) => r - dailyRiskFree);
  const volatility = annualizedVolatility(excess);
  if (!(volatility > 0)) return Number.NaN;
  return annualizedReturn(excess) / volatility;
}

export interface ValueAtRisk {
  /** Confidence level, e.g. 0.95. */
  confidence: number;
  /** The return at the loss quantile — normally negative. */
  quantile: number;
  /** Loss magnitude, reported positive: 0.021 means "lose 2.1% or worse". */
  valueAtRisk: number;
}

/**
 * Historical Value at Risk: the (1 - confidence) percentile of daily returns.
 * At 95% confidence this is the 5th percentile, per SKILL.md.
 *
 * Uses linear interpolation between order statistics (the same definition as
 * numpy's default and R's type 7), so the result is stable as the sample grows
 * rather than jumping between individual observations.
 */
export function historicalValueAtRisk(
  dailyReturns: readonly number[],
  confidence = 0.95,
): ValueAtRisk {
  if (dailyReturns.length === 0) throw new Error("VaR needs at least one observation");
  if (!(confidence > 0 && confidence < 1)) {
    throw new Error(`Confidence must lie strictly between 0 and 1, got ${confidence}`);
  }

  const sorted = [...dailyReturns].sort((a, b) => a - b);
  const quantile = percentile(sorted, 1 - confidence);

  return { confidence, quantile, valueAtRisk: -quantile };
}

/**
 * Conditional VaR (expected shortfall): the mean of returns at or below the VaR
 * quantile. Answers "given a tail day, how bad on average?" — which VaR alone
 * cannot.
 */
export function conditionalValueAtRisk(
  dailyReturns: readonly number[],
  confidence = 0.95,
): number {
  const { quantile } = historicalValueAtRisk(dailyReturns, confidence);
  const tail = dailyReturns.filter((r) => r <= quantile);
  // With a tiny sample the interpolated quantile can sit below every
  // observation; fall back to the single worst day.
  if (tail.length === 0) return -Math.min(...dailyReturns);
  return -mean(tail);
}

/** Linear-interpolated percentile of an ASCENDING-sorted array. */
export function percentile(sortedAscending: readonly number[], fraction: number): number {
  const n = sortedAscending.length;
  if (n === 0) throw new Error("percentile of an empty series is undefined");
  if (n === 1) return sortedAscending[0] as number;

  const position = fraction * (n - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedAscending[lowerIndex] ?? Number.NaN;
  const upper = sortedAscending[upperIndex] ?? Number.NaN;
  if (lowerIndex === upperIndex) return lower;
  return lower + (position - lowerIndex) * (upper - lower);
}

export interface MaxDrawdown {
  /** Positive fraction: 0.32 means a 32% peak-to-trough decline. */
  maxDrawdown: number;
  /** Date of the peak, or null when the peak is the start of the window. */
  peakDate: string | null;
  troughDate: string | null;
  /** Trading days from peak to trough. */
  durationDays: number;
}

/**
 * Maximum drawdown of the compounded wealth path.
 *
 * The running peak starts at 1.0 — the value before the first return — so a
 * portfolio that falls on day one records a drawdown from the window start
 * (`peakDate: null`) rather than missing it.
 */
export function maxDrawdown(series: ReturnSeries): MaxDrawdown {
  const wealth = wealthIndex(series.values);
  if (wealth.length === 0) {
    return { maxDrawdown: 0, peakDate: null, troughDate: null, durationDays: 0 };
  }

  let peak = 1;
  let peakIndex = -1;
  let worst = 0;
  let worstPeakIndex = -1;
  let worstTroughIndex = -1;

  for (let i = 0; i < wealth.length; i++) {
    const value = wealth[i] as number;
    if (value > peak) {
      peak = value;
      peakIndex = i;
      continue;
    }
    const drawdown = 1 - value / peak;
    if (drawdown > worst) {
      worst = drawdown;
      worstPeakIndex = peakIndex;
      worstTroughIndex = i;
    }
  }

  return {
    maxDrawdown: worst,
    peakDate: worstPeakIndex >= 0 ? (series.dates[worstPeakIndex] ?? null) : null,
    troughDate: worstTroughIndex >= 0 ? (series.dates[worstTroughIndex] ?? null) : null,
    durationDays: worstTroughIndex >= 0 ? worstTroughIndex - worstPeakIndex : 0,
  };
}

export interface RiskSummary {
  observations: number;
  annualizedReturn: number;
  annualizedGeometricReturn: number;
  cumulativeReturn: number;
  annualizedVolatility: number;
  maxDrawdown: MaxDrawdown;
  valueAtRisk95: ValueAtRisk;
  conditionalValueAtRisk95: number;
  sharpeRatio: number;
  /** Present only when a benchmark was supplied. */
  activeReturn: number | null;
  trackingError: number | null;
  informationRatio: number | null;
}

/** Everything the KPI card row in DESIGN.md needs, computed in one pass. */
export function summarizeRisk(
  portfolio: ReturnSeries,
  benchmark: ReturnSeries | null = null,
  dailyRiskFree = 0,
): RiskSummary {
  const active = benchmark ? activeReturns(portfolio, benchmark).values : null;

  return {
    observations: portfolio.values.length,
    annualizedReturn: annualizedReturn(portfolio.values),
    annualizedGeometricReturn: annualizedGeometricReturn(portfolio.values),
    cumulativeReturn: cumulativeReturn(portfolio.values),
    annualizedVolatility: annualizedVolatility(portfolio.values),
    maxDrawdown: maxDrawdown(portfolio),
    valueAtRisk95: historicalValueAtRisk(portfolio.values, 0.95),
    conditionalValueAtRisk95: conditionalValueAtRisk(portfolio.values, 0.95),
    sharpeRatio: sharpeRatio(portfolio.values, dailyRiskFree),
    activeReturn: active ? annualizedReturn(active) : null,
    trackingError: active ? trackingErrorFromActive(active) : null,
    informationRatio: active ? informationRatioFromActive(active) : null,
  };
}
