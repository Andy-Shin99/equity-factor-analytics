import {
  FACTOR_KEYS,
  FACTOR_LABELS,
  type FactorKey,
  type FactorObservation,
  type ReturnSeries,
} from "@/types/domain";

import { ols, type OlsFit } from "./ols";
import { excessReturns } from "./returns";
import { TRADING_DAYS_PER_YEAR } from "./risk";

/**
 * The multi-factor regression from SKILL.md:
 *
 *   Rp,t - Rf,t = alpha + SUM_i beta_i * F_i,t + eps_t
 *
 * Outputs annualised alpha, per-factor betas with standard errors, t-statistics
 * and p-values, plus adjusted R-squared.
 */

export interface FactorBeta {
  factor: FactorKey;
  label: string;
  estimate: number;
  standardError: number;
  tStat: number;
  pValue: number;
}

export interface FactorAlpha {
  /** Per-day intercept, in the units of the return series. */
  daily: number;
  /**
   * Annualised as daily x 252, matching the annualisation used for tracking
   * error and the information ratio. This is the arithmetic convention; it is
   * NOT compounded, because alpha is a rate of accrual rather than a realised
   * path.
   */
  annualized: number;
  standardError: number;
  tStat: number;
  pValue: number;
}

export interface FactorRegressionResult {
  factors: readonly FactorKey[];
  /** Dates actually used, after intersecting the return and factor series. */
  dates: string[];
  observations: number;
  /** Residual degrees of freedom. */
  df: number;
  alpha: FactorAlpha;
  betas: FactorBeta[];
  rSquared: number;
  adjustedRSquared: number;
  /** Annualised residual volatility — the idiosyncratic (non-factor) risk. */
  residualVolatilityAnnualized: number;
  /**
   * False when no risk-free rate was supplied, in which case `alpha` is a raw
   * intercept rather than a risk-adjusted one. Surface this in the UI: labelling
   * a raw intercept as "alpha" overstates skill by roughly the cash rate.
   */
  riskAdjusted: boolean;
  degenerate: boolean;
  /** The underlying fit, for callers that need residuals or fitted values. */
  fit: OlsFit;
}

export interface FactorRegressionOptions {
  /** Subset and ordering of factors to regress on. Defaults to all six. */
  factors?: readonly FactorKey[];
  /** Constant daily risk-free rate, or a date-matched series. Defaults to 0. */
  riskFree?: number | ReturnSeries;
}

export interface AlignedFactorData {
  dates: string[];
  y: number[];
  X: number[][];
}

/**
 * Intersect a return series with the factor observations.
 *
 * Both sides must be sampled on exactly the same trading days — a single day of
 * misalignment shifts every residual and corrupts alpha. The intersection is
 * driven by dates, never by position.
 */
export function alignFactorData(
  returns: ReturnSeries,
  observations: readonly FactorObservation[],
  factors: readonly FactorKey[],
): AlignedFactorData {
  const byDate = new Map<string, FactorObservation>();
  for (const observation of observations) byDate.set(observation.date, observation);

  const dates: string[] = [];
  const y: number[] = [];
  const X: number[][] = [];

  returns.dates.forEach((date, i) => {
    const value = returns.values[i];
    const observation = byDate.get(date);
    if (value === undefined || !observation) return;

    const row = factors.map((key) => observation.values[key]);
    if (row.some((v) => v === undefined || !Number.isFinite(v))) return;

    dates.push(date);
    y.push(value);
    X.push(row as number[]);
  });

  return { dates, y, X };
}

export function runFactorRegression(
  portfolio: ReturnSeries,
  observations: readonly FactorObservation[],
  options: FactorRegressionOptions = {},
): FactorRegressionResult {
  const factors = options.factors ?? FACTOR_KEYS;
  if (factors.length === 0) throw new Error("At least one factor is required");

  const riskFree = options.riskFree ?? 0;
  const riskAdjusted = typeof riskFree === "number" ? riskFree !== 0 : true;
  const dependent = excessReturns(portfolio, riskFree);

  const { dates, y, X } = alignFactorData(dependent, observations, factors);

  if (y.length < factors.length + 2) {
    throw new Error(
      `Only ${y.length} dates are common to the return series and the factor series; ` +
        `${factors.length} factors need at least ${factors.length + 2} observations. ` +
        "Check that factor_returns is populated over this window.",
    );
  }

  const fit = ols(y, X, {
    regressorNames: factors.map((key) => FACTOR_LABELS[key]),
    interceptName: "alpha",
  });

  const betas: FactorBeta[] = factors.map((key, index) => {
    const term = fit.terms[index];
    return {
      factor: key,
      label: FACTOR_LABELS[key],
      estimate: term?.estimate ?? Number.NaN,
      standardError: term?.standardError ?? Number.NaN,
      tStat: term?.tStat ?? Number.NaN,
      pValue: term?.pValue ?? Number.NaN,
    };
  });

  return {
    factors,
    dates,
    observations: fit.n,
    df: fit.df,
    alpha: {
      daily: fit.intercept.estimate,
      annualized: fit.intercept.estimate * TRADING_DAYS_PER_YEAR,
      standardError: fit.intercept.standardError,
      tStat: fit.intercept.tStat,
      pValue: fit.intercept.pValue,
    },
    betas,
    rSquared: fit.rSquared,
    adjustedRSquared: fit.adjustedRSquared,
    residualVolatilityAnnualized:
      fit.residualStandardError * Math.sqrt(TRADING_DAYS_PER_YEAR),
    riskAdjusted,
    degenerate: fit.degenerate,
    fit,
  };
}
