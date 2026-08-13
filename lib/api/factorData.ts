import { getSupabaseServerClient } from "@/lib/supabase";

import { dedupeByKey, readAllPages } from "./pagination";
import type { FactorReturnRow } from "@/types/database";
import {
  FACTOR_KEYS,
  type DateRange,
  type FactorKey,
  type FactorObservation,
  type ReturnSeries,
} from "@/types/domain";

/**
 * Read access to `factor_returns` — the right-hand side of every regression.
 *
 * Pure cache reads. Unlike prices, factor series are not collected on demand:
 * constructing a factor return requires a full cross-section, so it is a
 * scheduled backfill job, not something a request path can do.
 */

const SELECT_COLUMNS = ["date", ...FACTOR_KEYS].join(", ");

export interface GetFactorReturnsOptions {
  /**
   * Which factors the caller actually needs. Defaults to all of them.
   * An observation is only returned if every requested factor is non-null.
   */
  factors?: readonly FactorKey[];
}

export interface FactorSeriesMeta {
  requestedFactors: readonly FactorKey[];
  /** Observations inside the window before completeness filtering. */
  rowsRead: number;
  /** Observations dropped because at least one requested factor was null. */
  incompleteDropped: number;
  queryMs: number;
}

export interface FactorSeries {
  observations: FactorObservation[];
  meta: FactorSeriesMeta;
}

// --- pure helpers (exported for unit tests) -----------------------------------

/**
 * Convert a raw row into an observation, or null if any requested factor is
 * missing.
 *
 * Nulls are dropped, never imputed. `low_vol` is nullable (migration 02 added it
 * to an existing table), and treating a null as a 0% factor return would bias
 * every beta toward zero while leaving R-squared looking healthy — a silent
 * failure, which is the worst kind here.
 */
export function rowToObservation(
  row: FactorReturnRow,
  factors: readonly FactorKey[],
): FactorObservation | null {
  const values = {} as Record<FactorKey, number>;

  for (const key of factors) {
    const raw = row[key];
    if (raw === null || raw === undefined) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    values[key] = value;
  }

  return { date: row.date, values };
}

/**
 * Flatten observations into a design matrix for OLS.
 * `rows[i]` lines up with `dates[i]`; column order follows `factors`.
 */
export function toDesignMatrix(
  observations: FactorObservation[],
  factors: readonly FactorKey[],
): { dates: string[]; rows: number[][]; factors: readonly FactorKey[] } {
  return {
    dates: observations.map((o) => o.date),
    rows: observations.map((o) => factors.map((key) => o.values[key])),
    factors,
  };
}

/**
 * Restrict observations to dates present in `dates`.
 * The regression requires the portfolio return series and the factor series to
 * be sampled on exactly the same trading days; a misalignment of even one day
 * shifts every residual.
 */
export function alignToDates(
  observations: FactorObservation[],
  dates: readonly string[],
): FactorObservation[] {
  const wanted = new Set(dates);
  return observations.filter((o) => wanted.has(o.date));
}

// --- data access -------------------------------------------------------------

/**
 * Load daily factor returns over an inclusive date range.
 *
 * Returns Market, Size (SMB), Value (HML), Quality, Momentum and Low Vol by
 * default — the six columns of `factor_returns`.
 */
export async function getFactorReturns(
  range: DateRange,
  options: GetFactorReturnsOptions = {},
): Promise<FactorSeries> {
  const factors = options.factors ?? FACTOR_KEYS;

  if (range.from > range.to) {
    throw new Error(`Invalid range: from (${range.from}) is after to (${range.to})`);
  }

  const client = getSupabaseServerClient();
  const startedAt = Date.now();

  const { rows } = await readAllPages<FactorReturnRow>(async (from, to, wantCount) => {
    const { data, error, count } = await client
      .from("factor_returns")
      .select(SELECT_COLUMNS, wantCount ? { count: "exact" } : {})
      .gte("date", range.from)
      .lte("date", range.to)
      // Load-bearing for correct pagination, and the regression wants
      // chronological order anyway.
      .order("date", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to read factor_returns: ${error.message}`);
    }
    return { rows: (data ?? []) as unknown as FactorReturnRow[], total: count ?? null };
  });

  const observations: FactorObservation[] = [];
  let incompleteDropped = 0;
  const deduped = dedupeByKey(rows, (row) => row.date);

  for (const row of deduped) {
    const observation = rowToObservation(row, factors);
    if (observation) observations.push(observation);
    else incompleteDropped++;
  }

  const rowsRead = deduped.length;

  return {
    observations,
    meta: {
      requestedFactors: factors,
      rowsRead,
      incompleteDropped,
      queryMs: Date.now() - startedAt,
    },
  };
}

export interface FactorPanel {
  observations: FactorObservation[];
  riskFree: ReturnSeries;
  meta: FactorSeriesMeta & { riskFreeObservations: number };
}

/**
 * Load factors and the risk-free rate in ONE round trip.
 *
 * `getFactorReturns` + `getRiskFreeSeries` would read the same table twice. At
 * ~30ms per round trip to Tokyo that is pure waste, and the 100ms budget in
 * CLAUDE.md is spent on round trips rather than SQL — so any caller needing both
 * (i.e. every risk-adjusted regression) should use this.
 */
export async function getFactorPanel(
  range: DateRange,
  options: GetFactorReturnsOptions = {},
): Promise<FactorPanel> {
  const factors = options.factors ?? FACTOR_KEYS;

  if (range.from > range.to) {
    throw new Error(`Invalid range: from (${range.from}) is after to (${range.to})`);
  }

  const client = getSupabaseServerClient();
  const startedAt = Date.now();

  const { rows } = await readAllPages<FactorReturnRow>(async (from, to, wantCount) => {
    const { data, error, count } = await client
      .from("factor_returns")
      .select(`${SELECT_COLUMNS}, rf`, wantCount ? { count: "exact" } : {})
      .gte("date", range.from)
      .lte("date", range.to)
      .order("date", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to read factor_returns: ${error.message}`);
    }
    return { rows: (data ?? []) as unknown as FactorReturnRow[], total: count ?? null };
  });

  const observations: FactorObservation[] = [];
  const riskFreeDates: string[] = [];
  const riskFreeValues: number[] = [];
  let incompleteDropped = 0;

  // `date` is the primary key, so it is the dedupe key for pages read in parallel.
  const deduped = dedupeByKey(rows, (row) => row.date);

  for (const row of deduped) {
    const observation = rowToObservation(row, factors);
    if (observation) observations.push(observation);
    else incompleteDropped++;

    if (row.rf !== null) {
      const rf = Number(row.rf);
      if (Number.isFinite(rf)) {
        riskFreeDates.push(row.date);
        riskFreeValues.push(rf);
      }
    }
  }

  const rowsRead = deduped.length;

  return {
    observations,
    riskFree: { dates: riskFreeDates, values: riskFreeValues },
    meta: {
      requestedFactors: factors,
      rowsRead,
      incompleteDropped,
      riskFreeObservations: riskFreeValues.length,
      queryMs: Date.now() - startedAt,
    },
  };
}

/**
 * Load the daily risk-free rate series over a range.
 *
 * Separate from `getFactorReturns` because `rf` is not a factor: it belongs on
 * the regression's left-hand side, in (Rp - Rf). Pass the result as
 * `runFactorRegression`'s `riskFree` option to get a genuinely risk-adjusted
 * alpha instead of a raw intercept.
 */
export async function getRiskFreeSeries(range: DateRange): Promise<ReturnSeries> {
  if (range.from > range.to) {
    throw new Error(`Invalid range: from (${range.from}) is after to (${range.to})`);
  }

  const client = getSupabaseServerClient();

  const { rows } = await readAllPages(async (from, to, wantCount) => {
    const { data, error, count } = await client
      .from("factor_returns")
      .select("date, rf", wantCount ? { count: "exact" } : {})
      .gte("date", range.from)
      .lte("date", range.to)
      .order("date", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to read risk-free series: ${error.message}`);
    }
    return { rows: data ?? [], total: count ?? null };
  });

  const dates: string[] = [];
  const values: number[] = [];

  for (const row of dedupeByKey(rows, (row) => row.date)) {
    // Nulls are skipped, not zero-filled: a zero rate is a claim, not a gap.
    if (row.rf === null) continue;
    const value = Number(row.rf);
    if (!Number.isFinite(value)) continue;
    dates.push(row.date);
    values.push(value);
  }

  return { dates, values };
}

export interface FactorCoverage {
  first: string;
  last: string;
  count: number;
}

/**
 * Report what the factor table actually holds, without pulling it all down.
 *
 * Call this before running a regression: `factor_returns` starts out empty, and
 * "no factor data" must surface as an explicit, explainable state rather than an
 * OLS fit over zero observations.
 */
export async function getFactorCoverage(): Promise<FactorCoverage | null> {
  const client = getSupabaseServerClient();

  const [earliest, latest, counted] = await Promise.all([
    client.from("factor_returns").select("date").order("date", { ascending: true }).limit(1),
    client.from("factor_returns").select("date").order("date", { ascending: false }).limit(1),
    client.from("factor_returns").select("*", { count: "exact", head: true }),
  ]);

  const error = earliest.error ?? latest.error ?? counted.error;
  if (error) {
    throw new Error(`Failed to read factor_returns coverage: ${error.message}`);
  }

  const first = earliest.data?.[0]?.date;
  const last = latest.data?.[0]?.date;
  if (!first || !last) return null;

  return { first, last, count: counted.count ?? 0 };
}
