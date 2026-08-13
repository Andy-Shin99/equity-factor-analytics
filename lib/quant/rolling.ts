import {
  FACTOR_KEYS,
  FACTOR_LABELS,
  type FactorKey,
  type FactorObservation,
  type ReturnSeries,
} from "@/types/domain";

import { SingularMatrixError } from "./linalg";
import { ols } from "./ols";
import { alignFactorData } from "./factorModel";
import { excessReturns } from "./returns";
import { TRADING_DAYS_PER_YEAR } from "./risk";

/**
 * Rolling-window factor regressions — the engine behind style-drift monitoring.
 *
 * Each point re-fits the model on the trailing `window` observations, so a
 * manager who has quietly rotated from value into momentum shows up as a beta
 * trending across time rather than as a single blended average.
 */

/** The project's monitoring window (DESIGN.md: 60-day rolling factor beta). */
export const DEFAULT_ROLLING_WINDOW = 60;

export interface RollingPoint {
  /** Date of the LAST observation in the window — where the point is plotted. */
  date: string;
  /** First date in the window, for tooltips and drill-down. */
  windowStart: string;
  alphaDaily: number;
  alphaAnnualized: number;
  betas: Partial<Record<FactorKey, number>>;
  rSquared: number;
  adjustedRSquared: number;
}

export interface RollingBetaSeries {
  points: RollingPoint[];
  meta: {
    window: number;
    step: number;
    factors: readonly FactorKey[];
    /** Total dates common to the return and factor series. */
    alignedObservations: number;
    windowsAttempted: number;
    /**
     * Windows discarded because the factor matrix was singular inside them —
     * typically a factor that is constant over that short span.
     */
    windowsSkipped: number;
  };
}

export interface RollingOptions {
  window?: number;
  /** Advance between windows in observations. 1 = every trading day. */
  step?: number;
  factors?: readonly FactorKey[];
  riskFree?: number | ReturnSeries;
}

export function rollingFactorBetas(
  portfolio: ReturnSeries,
  observations: readonly FactorObservation[],
  options: RollingOptions = {},
): RollingBetaSeries {
  const {
    window = DEFAULT_ROLLING_WINDOW,
    step = 1,
    factors = FACTOR_KEYS,
    riskFree = 0,
  } = options;

  if (factors.length === 0) throw new Error("At least one factor is required");
  if (!Number.isInteger(step) || step < 1) {
    throw new Error(`step must be a positive integer, got ${step}`);
  }
  // Each window is an independent regression, so it needs its own residual
  // degrees of freedom — a 60-day window supports at most 58 regressors.
  if (!Number.isInteger(window) || window < factors.length + 2) {
    throw new Error(
      `window must be an integer of at least ${factors.length + 2} for ${factors.length} ` +
        `factors, got ${window}`,
    );
  }

  const dependent = excessReturns(portfolio, riskFree);
  const { dates, y, X } = alignFactorData(dependent, observations, factors);

  const names = factors.map((key) => FACTOR_LABELS[key]);
  const points: RollingPoint[] = [];
  let windowsAttempted = 0;
  let windowsSkipped = 0;

  for (let end = window; end <= y.length; end += step) {
    const start = end - window;
    windowsAttempted++;

    const windowY = y.slice(start, end);
    const windowX = X.slice(start, end);

    let fit;
    try {
      fit = ols(windowY, windowX, { regressorNames: names, interceptName: "alpha" });
    } catch (error) {
      // One degenerate window must not abort the whole drift series.
      if (error instanceof SingularMatrixError) {
        windowsSkipped++;
        continue;
      }
      throw error;
    }

    const betas: Partial<Record<FactorKey, number>> = {};
    factors.forEach((key, index) => {
      betas[key] = fit.terms[index]?.estimate ?? Number.NaN;
    });

    points.push({
      date: dates[end - 1] ?? "",
      windowStart: dates[start] ?? "",
      alphaDaily: fit.intercept.estimate,
      alphaAnnualized: fit.intercept.estimate * TRADING_DAYS_PER_YEAR,
      betas,
      rSquared: fit.rSquared,
      adjustedRSquared: fit.adjustedRSquared,
    });
  }

  return {
    points,
    meta: {
      window,
      step,
      factors,
      alignedObservations: y.length,
      windowsAttempted,
      windowsSkipped,
    },
  };
}

/**
 * Reshape rolling output for a Recharts timeseries, one row per date with a
 * column per factor label.
 */
export function toRollingChartRows(
  series: RollingBetaSeries,
): Array<Record<string, string | number>> {
  return series.points.map((point) => {
    const row: Record<string, string | number> = { date: point.date };
    for (const factor of series.meta.factors) {
      const value = point.betas[factor];
      if (value !== undefined) row[FACTOR_LABELS[factor]] = value;
    }
    return row;
  });
}
