import type { PortfolioHolding, PriceBar, ReturnSeries } from "@/types/domain";

/**
 * Turning prices into the return series every downstream metric consumes.
 *
 * Two rules hold throughout:
 *   - Returns are simple (arithmetic) daily returns on ADJUSTED closes.
 *   - A return is stamped with the date of its LATER price, so `dates[i]` is the
 *     day the return was earned. Getting this backwards shifts every regression
 *     by one day and quietly destroys the alpha estimate.
 */

/** Simple daily returns from a date-ascending bar series. */
export function toReturnSeries(bars: readonly PriceBar[]): ReturnSeries {
  const dates: string[] = [];
  const values: number[] = [];

  for (let i = 1; i < bars.length; i++) {
    const previous = bars[i - 1];
    const current = bars[i];
    if (!previous || !current) continue;
    if (previous.adjClose <= 0) continue;

    dates.push(current.date);
    values.push(current.adjClose / previous.adjClose - 1);
  }

  return { dates, values };
}

/** Restrict two series to their common dates, preserving order. */
export function alignSeries(
  a: ReturnSeries,
  b: ReturnSeries,
): { dates: string[]; a: number[]; b: number[] } {
  const bByDate = new Map<string, number>();
  b.dates.forEach((date, i) => {
    const value = b.values[i];
    if (value !== undefined) bByDate.set(date, value);
  });

  const dates: string[] = [];
  const left: number[] = [];
  const right: number[] = [];

  a.dates.forEach((date, i) => {
    const aValue = a.values[i];
    const bValue = bByDate.get(date);
    if (aValue === undefined || bValue === undefined) return;
    dates.push(date);
    left.push(aValue);
    right.push(bValue);
  });

  return { dates, a: left, b: right };
}

/**
 * Active return series, Rp - Rb, over the dates both series share.
 * Tracking error and the information ratio are both built on this.
 */
export function activeReturns(
  portfolio: ReturnSeries,
  benchmark: ReturnSeries,
): ReturnSeries {
  const aligned = alignSeries(portfolio, benchmark);
  return {
    dates: aligned.dates,
    values: aligned.dates.map((_, i) => (aligned.a[i] ?? 0) - (aligned.b[i] ?? 0)),
  };
}

/**
 * Excess return over the risk-free rate — the left-hand side of the
 * Fama-French regression in SKILL.md.
 *
 * `riskFree` may be a constant daily rate or a date-matched series. It defaults
 * to zero at the call site, in which case the regression intercept is a raw
 * rather than a risk-adjusted alpha; that distinction must reach the UI.
 */
export function excessReturns(
  series: ReturnSeries,
  riskFree: number | ReturnSeries,
): ReturnSeries {
  if (typeof riskFree === "number") {
    return { dates: [...series.dates], values: series.values.map((r) => r - riskFree) };
  }
  const aligned = alignSeries(series, riskFree);
  return {
    dates: aligned.dates,
    values: aligned.dates.map((_, i) => (aligned.a[i] ?? 0) - (aligned.b[i] ?? 0)),
  };
}

export type MissingDatePolicy = "strict" | "renormalize";

export interface PortfolioReturnOptions {
  /**
   * What to do on a date where some holding has no return.
   *
   * `strict` (default) drops the date entirely. `renormalize` keeps the date and
   * rescales the available holdings' weights to sum to one — convenient for
   * mixed US/KRX portfolios whose holiday calendars differ, but it silently
   * changes that day's exposure, so the count of affected dates is reported.
   */
  missingDatePolicy?: MissingDatePolicy;
  /** Tolerance on |sum(weights) - 1| before weights are renormalised. */
  weightTolerance?: number;
}

export interface PortfolioReturnResult {
  series: ReturnSeries;
  meta: {
    holdings: number;
    /** Holdings with no usable price history at all. */
    tickersMissing: string[];
    datesUsed: number;
    /** Dates excluded because a holding had no return (`strict` only). */
    datesDropped: string[];
    /** Dates kept with rescaled weights (`renormalize` only). */
    datesPartial: string[];
    weightSum: number;
    weightsNormalized: boolean;
  };
}

/**
 * Aggregate holdings into a single portfolio return series.
 *
 * Assumes daily rebalancing back to the target weights — the standard
 * convention for style/factor attribution, and the only one available without a
 * share-count history. It is NOT buy-and-hold: weights do not drift.
 */
export function buildPortfolioReturns(
  panel: Readonly<Record<string, readonly PriceBar[]>>,
  holdings: readonly PortfolioHolding[],
  options: PortfolioReturnOptions = {},
): PortfolioReturnResult {
  const { missingDatePolicy = "strict", weightTolerance = 1e-6 } = options;

  if (holdings.length === 0) throw new Error("Portfolio has no holdings");

  const rawSum = holdings.reduce((sum, h) => sum + h.weight, 0);
  if (rawSum <= 0) {
    throw new Error(`Portfolio weights sum to ${rawSum}; expected a positive total`);
  }

  const weightsNormalized = Math.abs(rawSum - 1) > weightTolerance;
  const normalized = holdings.map((h) => ({
    ticker: h.ticker,
    weight: weightsNormalized ? h.weight / rawSum : h.weight,
  }));

  const tickersMissing: string[] = [];
  const returnsByTicker = new Map<string, Map<string, number>>();
  const dateUnion = new Set<string>();

  for (const holding of normalized) {
    const bars = panel[holding.ticker];
    const series = bars ? toReturnSeries(bars) : { dates: [], values: [] };
    if (series.dates.length === 0) {
      tickersMissing.push(holding.ticker);
      continue;
    }
    const byDate = new Map<string, number>();
    series.dates.forEach((date, i) => {
      const value = series.values[i];
      if (value === undefined) return;
      byDate.set(date, value);
      dateUnion.add(date);
    });
    returnsByTicker.set(holding.ticker, byDate);
  }

  const usable = normalized.filter((h) => returnsByTicker.has(h.ticker));
  if (usable.length === 0) {
    throw new Error(
      `No price history for any holding (${tickersMissing.join(", ")}); cannot build a return series`,
    );
  }

  const dates: string[] = [];
  const values: number[] = [];
  const datesDropped: string[] = [];
  const datesPartial: string[] = [];

  for (const date of [...dateUnion].sort()) {
    const present = usable.filter((h) => returnsByTicker.get(h.ticker)?.has(date));

    if (present.length !== usable.length) {
      if (missingDatePolicy === "strict") {
        datesDropped.push(date);
        continue;
      }
      datesPartial.push(date);
    }

    const presentWeight = present.reduce((sum, h) => sum + h.weight, 0);
    if (presentWeight <= 0) {
      datesDropped.push(date);
      continue;
    }

    let value = 0;
    for (const holding of present) {
      const r = returnsByTicker.get(holding.ticker)?.get(date) ?? 0;
      value += (holding.weight / presentWeight) * r;
    }

    dates.push(date);
    values.push(value);
  }

  return {
    series: { dates, values },
    meta: {
      holdings: holdings.length,
      tickersMissing,
      datesUsed: dates.length,
      datesDropped,
      datesPartial,
      weightSum: rawSum,
      weightsNormalized,
    },
  };
}

/** Wealth index starting at 1.0, i.e. cumprod(1 + r). */
export function wealthIndex(returns: readonly number[]): number[] {
  const index: number[] = [];
  let wealth = 1;
  for (const r of returns) {
    wealth *= 1 + r;
    index.push(wealth);
  }
  return index;
}
