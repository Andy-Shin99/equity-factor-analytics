import { getSupabaseAdminClient } from "@/lib/supabase";
import { toReturnSeries } from "@/lib/quant/returns";
import type { FactorReturnRow } from "@/types/database";
import type { DateRange, PriceBar, ReturnSeries } from "@/types/domain";

import {
  FACTOR_DEFINITIONS,
  FACTOR_HISTORY_START,
  REQUIRED_TICKERS,
  RISK_FREE_PROXY,
  type FactorDefinition,
} from "./factorDefinitions";
import { chunk, getDailyPrices, isoToday, type PricePanelMeta } from "./marketData";

/**
 * Builds the `factor_returns` series from ETF proxy spreads (see
 * factorDefinitions.ts) and upserts it.
 *
 * This is a scheduled job, never a request-path operation: it prices eight ETFs
 * over years of history. It reuses the same cache-first price layer as
 * everything else, so a re-run after the initial backfill touches Yahoo only for
 * the missing tail.
 */

/** Postgres upsert batches, matching the price cache's chunk size. */
const UPSERT_CHUNK_SIZE = 500;

export interface BackfillOptions {
  /** Defaults to FACTOR_HISTORY_START .. today. */
  range?: DateRange;
  /** Overridable for deterministic tests. */
  today?: string;
  /**
   * Compute and report without writing. Useful for checking coverage before
   * committing rows.
   */
  dryRun?: boolean;
  signal?: AbortSignal;
}

export interface BackfillResult {
  range: DateRange;
  tickers: readonly string[];
  priceMeta: PricePanelMeta;
  /** Dates for which a complete factor row was produced. */
  datesComputed: number;
  /** Dates dropped because at least one ETF leg had no return that day. */
  datesSkipped: string[];
  rowsUpserted: number;
  first: string | null;
  last: string | null;
  dryRun: boolean;
  elapsedMs: number;
}

/**
 * Compute factor rows from per-ticker return series.
 *
 * Pure, so the spread arithmetic is unit-testable without network or database.
 *
 * A date is emitted only when EVERY leg has a return. Partial rows would mean
 * `market_rf` computed on one calendar and `hml` on another, which is exactly
 * the kind of misalignment that corrupts a regression while looking healthy.
 */
export function buildFactorRows(
  seriesByTicker: Readonly<Record<string, ReturnSeries>>,
  definitions: readonly FactorDefinition[] = FACTOR_DEFINITIONS,
  riskFreeTicker: string = RISK_FREE_PROXY,
): { rows: FactorReturnRow[]; datesSkipped: string[] } {
  const required = [
    ...new Set([...definitions.flatMap((d) => [d.long, d.short]), riskFreeTicker]),
  ];

  const lookup = new Map<string, Map<string, number>>();
  for (const ticker of required) {
    const series = seriesByTicker[ticker];
    const byDate = new Map<string, number>();
    if (series) {
      series.dates.forEach((date, i) => {
        const value = series.values[i];
        if (value !== undefined && Number.isFinite(value)) byDate.set(date, value);
      });
    }
    lookup.set(ticker, byDate);
  }

  // Drive the date set off the risk-free leg when present, else the union; then
  // require completeness. Using a union alone would iterate dates no leg shares.
  const candidateDates = new Set<string>();
  for (const byDate of lookup.values()) {
    for (const date of byDate.keys()) candidateDates.add(date);
  }

  const rows: FactorReturnRow[] = [];
  const datesSkipped: string[] = [];

  for (const date of [...candidateDates].sort()) {
    const complete = required.every((ticker) => lookup.get(ticker)?.has(date));
    if (!complete) {
      datesSkipped.push(date);
      continue;
    }

    const spread = (definition: FactorDefinition): number => {
      const long = lookup.get(definition.long)?.get(date) ?? 0;
      const short = lookup.get(definition.short)?.get(date) ?? 0;
      return long - short;
    };

    const byKey = new Map(definitions.map((d) => [d.key, spread(d)]));

    rows.push({
      date,
      market_rf: byKey.get("market_rf") ?? 0,
      smb: byKey.get("smb") ?? 0,
      hml: byKey.get("hml") ?? 0,
      quality: byKey.get("quality") ?? 0,
      momentum: byKey.get("momentum") ?? 0,
      low_vol: byKey.get("low_vol") ?? null,
      rf: lookup.get(riskFreeTicker)?.get(date) ?? null,
    });
  }

  return { rows, datesSkipped };
}

async function upsertFactorRows(rows: FactorReturnRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const client = getSupabaseAdminClient();

  let written = 0;
  for (const batch of chunk(rows, UPSERT_CHUNK_SIZE)) {
    const { error } = await client
      .from("factor_returns")
      .upsert(batch, { onConflict: "date" });

    if (error) {
      throw new Error(
        `Failed to upsert factor_returns: ${error.message}. ` +
          "If this mentions a missing column, apply migrations 02 and 03.",
      );
    }
    written += batch.length;
  }
  return written;
}

/** Run the backfill over `range` (default: full available history). */
export async function backfillFactorReturns(
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  const startedAt = Date.now();
  const today = options.today ?? isoToday();
  const range = options.range ?? { from: FACTOR_HISTORY_START, to: today };
  const dryRun = options.dryRun ?? false;

  // The price layer needs to be allowed to fetch every leg on a cold cache.
  const panel = await getDailyPrices([...REQUIRED_TICKERS], range, {
    allowFetch: true,
    maxFetches: REQUIRED_TICKERS.length,
    today,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const missing = REQUIRED_TICKERS.filter((ticker) => !panel.series[ticker]);
  if (missing.length > 0) {
    throw new Error(
      `No price history for factor leg(s): ${missing.join(", ")}. ` +
        `Failures: ${JSON.stringify(panel.meta.failed)}`,
    );
  }

  const seriesByTicker: Record<string, ReturnSeries> = {};
  for (const ticker of REQUIRED_TICKERS) {
    const bars: readonly PriceBar[] = panel.series[ticker] ?? [];
    seriesByTicker[ticker] = toReturnSeries(bars);
  }

  const { rows, datesSkipped } = buildFactorRows(seriesByTicker);
  const rowsUpserted = dryRun ? 0 : await upsertFactorRows(rows);

  return {
    range,
    tickers: REQUIRED_TICKERS,
    priceMeta: panel.meta,
    datesComputed: rows.length,
    datesSkipped,
    rowsUpserted,
    first: rows[0]?.date ?? null,
    last: rows[rows.length - 1]?.date ?? null,
    dryRun,
    elapsedMs: Date.now() - startedAt,
  };
}
