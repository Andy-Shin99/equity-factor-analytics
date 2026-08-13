import { getFactorPanel } from "@/lib/api/factorData";
import { getDailyPrices, type PricePanelMeta } from "@/lib/api/marketData";
import { runFactorRegression, type FactorBeta } from "@/lib/quant/factorModel";
import {
  buildPortfolioReturns,
  toReturnSeries,
  type MissingDatePolicy,
} from "@/lib/quant/returns";
import { summarizeRisk, type RiskSummary } from "@/lib/quant/risk";
import {
  DEFAULT_ROLLING_WINDOW,
  rollingFactorBetas,
  type RollingPoint,
} from "@/lib/quant/rolling";
import {
  FACTOR_KEYS,
  FACTOR_LABELS,
  STYLE_FACTOR_KEYS,
  type DateRange,
  type FactorKey,
  type PortfolioHolding,
  type ReturnSeries,
} from "@/types/domain";

/**
 * Composition layer: pulls cached data, runs the quant engine, and returns a
 * single payload shaped for the dashboard.
 *
 * Sits above lib/quant (pure math, no I/O) and lib/api (I/O, no math). Kept
 * separate from the route handler so the whole analytics path is callable — and
 * testable — without HTTP.
 *
 * SERVERLESS SHAPE
 *   - Exactly two database round trips: one price read covering the portfolio
 *     AND the benchmark together, one factor read covering factors AND rf
 *     together. At ~30ms per trip to Tokyo, collapsing four trips into two is
 *     the single largest lever on the 100ms budget in CLAUDE.md.
 *   - Residual and fitted arrays are dropped from the response. They are
 *     O(observations) each and no chart in DESIGN.md consumes them.
 */

export interface AnalyticsInput {
  holdings: readonly PortfolioHolding[];
  benchmark: string;
  range: DateRange;
  factors?: readonly FactorKey[];
  rollingWindow?: number;
  /** Advance between rolling windows; raise it to shrink the payload. */
  rollingStep?: number;
  missingDatePolicy?: MissingDatePolicy;
  /** Allow gap-filling from the external provider. */
  allowFetch?: boolean;
  maxFetches?: number;
  /** Include the full portfolio return series in the response. */
  includePortfolioSeries?: boolean;
  signal?: AbortSignal;
}

export interface FactorExposure {
  factor: FactorKey;
  label: string;
  beta: number;
  standardError: number;
  tStat: number;
  pValue: number;
  /** Two-sided significance at 5%. */
  significant: boolean;
}

export interface AnalyticsResult {
  range: DateRange;
  benchmark: string;
  factors: readonly FactorKey[];
  regression: {
    observations: number;
    df: number;
    alpha: {
      daily: number;
      annualized: number;
      standardError: number;
      tStat: number;
      pValue: number;
    };
    betas: FactorBeta[];
    rSquared: number;
    adjustedRSquared: number;
    residualVolatilityAnnualized: number;
    riskAdjusted: boolean;
    degenerate: boolean;
  };
  /** Radar-chart series: the five style axes in DESIGN.md order. */
  styleExposure: FactorExposure[];
  rolling: {
    window: number;
    step: number;
    points: RollingPoint[];
    windowsSkipped: number;
  };
  risk: RiskSummary;
  portfolioSeries?: ReturnSeries;
  data: {
    prices: PricePanelMeta;
    factors: {
      rowsRead: number;
      incompleteDropped: number;
      riskFreeObservations: number;
      queryMs: number;
    };
    portfolio: {
      datesUsed: number;
      datesDropped: number;
      datesPartial: number;
      tickersMissing: string[];
      weightSum: number;
      weightsNormalized: boolean;
    };
  };
  timings: { pricesMs: number; factorsMs: number; computeMs: number; totalMs: number };
  /**
   * Conditions a PM must see before trusting the numbers. Machine-readable on
   * purpose — silently degraded analytics are worse than none.
   */
  warnings: string[];
}

export class AnalyticsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsError";
  }
}

export async function runPortfolioAnalytics(
  input: AnalyticsInput,
): Promise<AnalyticsResult> {
  const startedAt = Date.now();

  const {
    holdings,
    benchmark,
    range,
    factors = FACTOR_KEYS,
    rollingWindow = DEFAULT_ROLLING_WINDOW,
    rollingStep = 1,
    missingDatePolicy = "strict",
    allowFetch = true,
    maxFetches,
    includePortfolioSeries = false,
    signal,
  } = input;

  if (holdings.length === 0) throw new AnalyticsError("Portfolio has no holdings");

  const warnings: string[] = [];

  // --- prices and factors are independent reads, so they overlap.
  // Sequentially this cost the sum of both; concurrently it costs the slower one.
  const readStartedAt = Date.now();
  const tickers = [...new Set([...holdings.map((h) => h.ticker), benchmark])];

  let pricesMs = 0;
  let factorsMs = 0;

  const [panel, factorPanel] = await Promise.all([
    getDailyPrices(tickers, range, {
      allowFetch,
      ...(maxFetches !== undefined ? { maxFetches } : {}),
      ...(signal ? { signal } : {}),
    }).then((result) => {
      pricesMs = Date.now() - readStartedAt;
      return result;
    }),
    getFactorPanel(range, { factors }).then((result) => {
      factorsMs = Date.now() - readStartedAt;
      return result;
    }),
  ]);

  const benchmarkBars = panel.series[benchmark];
  if (!benchmarkBars || benchmarkBars.length < 2) {
    throw new AnalyticsError(
      `No usable price history for benchmark ${benchmark} over ${range.from}..${range.to}`,
    );
  }

  if (panel.meta.failed.length > 0) {
    warnings.push(
      `Price collection failed for ${panel.meta.failed
        .map((f) => `${f.ticker} (${f.reason})`)
        .join("; ")}`,
    );
  }
  if (panel.meta.deferred.length > 0) {
    warnings.push(
      `Collection deferred for ${panel.meta.deferred.join(", ")} because the per-request fetch cap was reached; results use cached history only. Re-request to continue filling.`,
    );
  }
  if (panel.meta.empty.length > 0) {
    warnings.push(`No price history at all for ${panel.meta.empty.join(", ")}`);
  }

  if (factorPanel.observations.length === 0) {
    throw new AnalyticsError(
      `factor_returns holds no complete observations over ${range.from}..${range.to}. ` +
        "Run the factor backfill (/api/factors/backfill) for this window.",
    );
  }
  if (factorPanel.meta.incompleteDropped > 0) {
    warnings.push(
      `${factorPanel.meta.incompleteDropped} factor dates dropped for missing values.`,
    );
  }

  const useRiskFree = factorPanel.riskFree.values.length > 0;
  if (!useRiskFree) {
    warnings.push(
      "No risk-free series available for this window, so alpha is a RAW intercept, not risk-adjusted. It overstates skill by roughly the cash rate.",
    );
  }

  // --- compute
  const computeStartedAt = Date.now();

  const portfolio = buildPortfolioReturns(panel.series, holdings, { missingDatePolicy });
  if (portfolio.meta.tickersMissing.length > 0) {
    warnings.push(
      `Excluded from the portfolio for lack of history: ${portfolio.meta.tickersMissing.join(", ")}`,
    );
  }
  if (portfolio.meta.datesDropped.length > 0) {
    warnings.push(
      `${portfolio.meta.datesDropped.length} dates dropped where at least one holding had no return (strict policy; mixed US/KRX calendars do this).`,
    );
  }
  if (portfolio.meta.datesPartial.length > 0) {
    warnings.push(
      `${portfolio.meta.datesPartial.length} dates used with rescaled weights, which changes that day's exposure.`,
    );
  }
  if (portfolio.meta.weightsNormalized) {
    warnings.push(
      `Weights summed to ${portfolio.meta.weightSum.toFixed(6)} and were rescaled to 1.0.`,
    );
  }

  const benchmarkSeries = toReturnSeries(benchmarkBars);
  const regressionOptions = {
    factors,
    ...(useRiskFree ? { riskFree: factorPanel.riskFree } : {}),
  };

  const regression = runFactorRegression(
    portfolio.series,
    factorPanel.observations,
    regressionOptions,
  );

  if (regression.degenerate) {
    warnings.push(
      "The regression is degenerate — the factors explain essentially all variance. Inference is reported as NaN; check that the portfolio is not identical to a factor leg.",
    );
  }

  const rolling =
    portfolio.series.values.length >= rollingWindow
      ? rollingFactorBetas(portfolio.series, factorPanel.observations, {
          window: rollingWindow,
          step: rollingStep,
          ...regressionOptions,
        })
      : null;

  if (!rolling) {
    warnings.push(
      `Only ${portfolio.series.values.length} observations available; a ${rollingWindow}-day rolling beta needs at least ${rollingWindow}. Style drift is unavailable.`,
    );
  } else if (rolling.meta.windowsSkipped > 0) {
    warnings.push(
      `${rolling.meta.windowsSkipped} rolling windows skipped as singular (a factor was constant within them).`,
    );
  }

  const risk = summarizeRisk(portfolio.series, benchmarkSeries);
  const computeMs = Date.now() - computeStartedAt;

  const byFactor = new Map(regression.betas.map((b) => [b.factor, b]));
  const styleExposure: FactorExposure[] = STYLE_FACTOR_KEYS.filter((key) =>
    byFactor.has(key),
  ).map((key) => {
    const beta = byFactor.get(key);
    return {
      factor: key,
      label: FACTOR_LABELS[key],
      beta: beta?.estimate ?? Number.NaN,
      standardError: beta?.standardError ?? Number.NaN,
      tStat: beta?.tStat ?? Number.NaN,
      pValue: beta?.pValue ?? Number.NaN,
      significant: (beta?.pValue ?? 1) < 0.05,
    };
  });

  return {
    range,
    benchmark,
    factors,
    regression: {
      observations: regression.observations,
      df: regression.df,
      alpha: regression.alpha,
      betas: regression.betas,
      rSquared: regression.rSquared,
      adjustedRSquared: regression.adjustedRSquared,
      residualVolatilityAnnualized: regression.residualVolatilityAnnualized,
      riskAdjusted: regression.riskAdjusted,
      degenerate: regression.degenerate,
    },
    styleExposure,
    rolling: {
      window: rollingWindow,
      step: rollingStep,
      points: rolling?.points ?? [],
      windowsSkipped: rolling?.meta.windowsSkipped ?? 0,
    },
    risk,
    ...(includePortfolioSeries ? { portfolioSeries: portfolio.series } : {}),
    data: {
      prices: panel.meta,
      factors: {
        rowsRead: factorPanel.meta.rowsRead,
        incompleteDropped: factorPanel.meta.incompleteDropped,
        riskFreeObservations: factorPanel.meta.riskFreeObservations,
        queryMs: factorPanel.meta.queryMs,
      },
      portfolio: {
        datesUsed: portfolio.meta.datesUsed,
        datesDropped: portfolio.meta.datesDropped.length,
        datesPartial: portfolio.meta.datesPartial.length,
        tickersMissing: portfolio.meta.tickersMissing,
        weightSum: portfolio.meta.weightSum,
        weightsNormalized: portfolio.meta.weightsNormalized,
      },
    },
    timings: { pricesMs, factorsMs, computeMs, totalMs: Date.now() - startedAt },
    warnings,
  };
}
