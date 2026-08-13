import { getSupabaseAdminClient, getSupabaseServerClient } from "@/lib/supabase";
import type { DailyPriceRow } from "@/types/database";
import type { DateRange, PriceBar } from "@/types/domain";

import { chunk, mapWithConcurrency } from "./concurrency";
import { dedupeByKey, readAllPages } from "./pagination";
import { fetchYahooDailyBars, YahooFinanceError } from "./yahooFinance";

// Re-exported so existing callers and tests keep a single import site.
export { chunk, mapWithConcurrency };

/**
 * Cache-first daily price access.
 *
 * Read path: one paginated SELECT against `daily_prices`, nothing else. External
 * collection happens only for tickers whose cached coverage does not span the
 * requested window (CLAUDE.md: the DB *is* the primary cache).
 */

/** Postgres rejects an upsert batch that touches the same PK twice, so batches stay small and deduped. */
const UPSERT_CHUNK_SIZE = 500;

/** Yahoo throttles aggressive callers; keep concurrent symbol fetches low. */
const FETCH_CONCURRENCY = 4;

/**
 * Hard cap on external fetches per invocation. The request path must never turn
 * into a bulk collector — that is what blows Vercel's function duration limit.
 * Tickers beyond the cap are reported as `deferred` and served from whatever is
 * cached, so the caller can decide whether to re-request or schedule a backfill.
 */
const DEFAULT_MAX_FETCHES = 8;

/**
 * How many calendar days of missing tail is tolerated before a ticker counts as
 * stale. Four days absorbs a weekend plus a public holiday without triggering a
 * pointless refetch. Deliberately calendar-based: a real trading calendar for
 * NYSE *and* KRX is a data dependency this project does not need.
 */
const DEFAULT_FRESHNESS_TOLERANCE_DAYS = 4;

export interface GetDailyPricesOptions {
  /** Set false to read cache only and never call the external API. */
  allowFetch?: boolean;
  maxFetches?: number;
  freshnessToleranceDays?: number;
  /** Overridable for deterministic tests. Defaults to today (UTC). */
  today?: string;
  signal?: AbortSignal;
}

export interface PricePanelMeta {
  requested: string[];
  /** Cached coverage already satisfied the request. */
  servedFromCache: string[];
  /** Gap detected and successfully collected. */
  fetched: string[];
  /** Gap detected but skipped because `maxFetches` was reached. */
  deferred: string[];
  failed: Array<{ ticker: string; reason: string }>;
  /** Tickers with no usable bars at all after the whole process. */
  empty: string[];
  cacheReadMs: number;
  /** HTTP requests the paginated cache read needed; the latency driver. */
  cacheReadRequests: number;
  totalMs: number;
}

export interface PricePanel {
  /** Ticker -> bars, ascending by date. Missing tickers are absent, not empty. */
  series: Record<string, PriceBar[]>;
  meta: PricePanelMeta;
}

// --- pure helpers (exported for unit tests) -----------------------------------

export function isoToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`Invalid ISO date: ${isoDate}`);
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/** Yahoo symbols are case-sensitive in suffix only; upper-case is canonical. */
export function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

export interface Coverage {
  first: string;
  last: string;
}

/**
 * Decide what still needs collecting for one ticker.
 *
 * Returns null when the cache already covers the window. Interior holes are
 * deliberately NOT chased: exchange holidays and halts mean a per-day
 * completeness check can never be satisfied, and a naive one would refetch the
 * same symbol on every request forever. Only two real gaps are detected —
 * missing leading history and a stale tail.
 *
 * `toleranceDays` applies to BOTH edges, and it is load-bearing on the leading
 * edge too: request a window starting 2020-01-01 and the first cached bar is
 * 2020-01-02, because 2020-01-01 was a holiday. Comparing the two dates exactly
 * would flag that as missing history and refetch the symbol on every request
 * forever.
 */
export function computeFetchRange(
  coverage: Coverage | null,
  range: DateRange,
  today: string,
  toleranceDays: number,
): DateRange | null {
  if (!coverage) return range;

  const needsHistory = coverage.first > addDays(range.from, toleranceDays);

  // The requested window may extend into the future; staleness is only ever
  // measured against data that could actually exist yet.
  const effectiveTo = range.to < today ? range.to : today;
  const staleCutoff = addDays(effectiveTo, -toleranceDays);
  const needsRecent = coverage.last < staleCutoff;

  if (!needsHistory && !needsRecent) return null;

  // When leading history is missing, refetch the whole window in one request
  // rather than issuing two. One round trip beats a minimal payload here.
  return {
    from: needsHistory ? range.from : addDays(coverage.last, 1),
    to: range.to,
  };
}

export function rowToBar(row: DailyPriceRow): PriceBar {
  return {
    ticker: row.ticker,
    date: row.date,
    adjClose: Number(row.adj_close),
    volume: row.volume === null ? null : Number(row.volume),
  };
}

export function groupByTicker(bars: PriceBar[]): Record<string, PriceBar[]> {
  const grouped: Record<string, PriceBar[]> = {};
  for (const bar of bars) {
    (grouped[bar.ticker] ??= []).push(bar);
  }
  for (const series of Object.values(grouped)) {
    series.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  return grouped;
}

export function coverageOf(bars: PriceBar[] | undefined): Coverage | null {
  if (!bars || bars.length === 0) return null;
  // groupByTicker guarantees ascending order.
  const first = bars[0];
  const last = bars[bars.length - 1];
  if (!first || !last) return null;
  return { first: first.date, last: last.date };
}

/**
 * Drop duplicate (ticker, date) pairs, keeping the last occurrence.
 * Postgres raises "ON CONFLICT DO UPDATE command cannot affect row a second
 * time" if a single upsert batch contains the same primary key twice.
 */
export function dedupeRows(rows: DailyPriceRow[]): DailyPriceRow[] {
  const byKey = new Map<string, DailyPriceRow>();
  for (const row of rows) {
    byKey.set(`${row.ticker}|${row.date}`, row);
  }
  return [...byKey.values()];
}

// --- data access -------------------------------------------------------------

/**
 * Read every cached bar for the requested tickers over the window.
 *
 * The explicit ORDER BY is load-bearing: `range()` pagination over an unordered
 * result set can repeat or skip rows between pages. Pages are then fetched
 * concurrently — see lib/api/pagination.ts for why that matters here — and
 * deduplicated by (ticker, date) so a concurrent insert cannot corrupt the panel.
 */
async function readCachedBars(
  tickers: string[],
  range: DateRange,
): Promise<{ bars: PriceBar[]; requests: number }> {
  const client = getSupabaseServerClient();

  const { rows, requests } = await readAllPages<DailyPriceRow>(
    async (from, to, wantCount) => {
      const { data, error, count } = await client
        .from("daily_prices")
        .select("ticker, date, adj_close, volume", wantCount ? { count: "exact" } : {})
        .in("ticker", tickers)
        .gte("date", range.from)
        .lte("date", range.to)
        .order("ticker", { ascending: true })
        .order("date", { ascending: true })
        .range(from, to);

      if (error) {
        throw new Error(`Failed to read daily_prices cache: ${error.message}`);
      }
      return { rows: data ?? [], total: count ?? null };
    },
  );

  const deduped = dedupeByKey(rows, (row) => `${row.ticker}|${row.date}`);
  return { bars: deduped.map(rowToBar), requests };
}

/** Upsert collected bars through the service role client, in deduped chunks. */
async function upsertBars(rows: DailyPriceRow[]): Promise<void> {
  if (rows.length === 0) return;
  const client = getSupabaseAdminClient();

  for (const batch of chunk(dedupeRows(rows), UPSERT_CHUNK_SIZE)) {
    const { error } = await client
      .from("daily_prices")
      .upsert(batch, { onConflict: "ticker,date" });

    if (error) {
      throw new Error(`Failed to upsert daily_prices: ${error.message}`);
    }
  }
}

// --- public API --------------------------------------------------------------

/**
 * Fetch daily adjusted prices for a set of tickers, cache-first.
 *
 * 1. One paginated read of `daily_prices` over the window.
 * 2. Per ticker, decide whether coverage is sufficient.
 * 3. Collect only the gaps (bounded by `maxFetches`), upsert, and merge.
 *
 * Collection failures are non-fatal: they land in `meta.failed` and whatever is
 * cached is still returned, so one delisted symbol cannot take down a whole
 * portfolio's analytics.
 */
export async function getDailyPrices(
  tickers: string[],
  range: DateRange,
  options: GetDailyPricesOptions = {},
): Promise<PricePanel> {
  const startedAt = Date.now();

  const {
    allowFetch = true,
    maxFetches = DEFAULT_MAX_FETCHES,
    freshnessToleranceDays = DEFAULT_FRESHNESS_TOLERANCE_DAYS,
    today = isoToday(),
    signal,
  } = options;

  const requested = [...new Set(tickers.map(normalizeTicker))].filter(Boolean);

  if (requested.length === 0) {
    return {
      series: {},
      meta: {
        requested: [],
        servedFromCache: [],
        fetched: [],
        deferred: [],
        failed: [],
        empty: [],
        cacheReadMs: 0,
        cacheReadRequests: 0,
        totalMs: Date.now() - startedAt,
      },
    };
  }

  if (range.from > range.to) {
    throw new Error(`Invalid range: from (${range.from}) is after to (${range.to})`);
  }

  // --- 1. cache read
  const cacheStartedAt = Date.now();
  const cacheRead = await readCachedBars(requested, range);
  const series = groupByTicker(cacheRead.bars);
  const cacheReadMs = Date.now() - cacheStartedAt;

  // --- 2. gap detection
  const gaps: Array<{ ticker: string; range: DateRange }> = [];
  const servedFromCache: string[] = [];

  for (const ticker of requested) {
    const gap = computeFetchRange(
      coverageOf(series[ticker]),
      range,
      today,
      freshnessToleranceDays,
    );
    if (gap) gaps.push({ ticker, range: gap });
    else servedFromCache.push(ticker);
  }

  const meta: PricePanelMeta = {
    requested,
    servedFromCache,
    fetched: [],
    deferred: [],
    failed: [],
    empty: [],
    cacheReadMs,
    cacheReadRequests: cacheRead.requests,
    totalMs: 0,
  };

  // --- 3. bounded collection
  const toFetch = allowFetch ? gaps.slice(0, maxFetches) : [];
  meta.deferred = gaps.slice(toFetch.length).map((g) => g.ticker);

  if (toFetch.length > 0) {
    const collected = await mapWithConcurrency(
      toFetch,
      FETCH_CONCURRENCY,
      async ({ ticker, range: gapRange }) => {
        try {
          const bars = await fetchYahooDailyBars(
            ticker,
            gapRange.from,
            gapRange.to,
            signal,
          );
          return { ticker, bars, error: null as string | null };
        } catch (error) {
          const reason =
            error instanceof YahooFinanceError || error instanceof Error
              ? error.message
              : String(error);
          return { ticker, bars: [] as Awaited<ReturnType<typeof fetchYahooDailyBars>>, error: reason };
        }
      },
    );

    const rows: DailyPriceRow[] = [];

    for (const outcome of collected) {
      if (outcome.error !== null) {
        meta.failed.push({ ticker: outcome.ticker, reason: outcome.error });
        continue;
      }
      meta.fetched.push(outcome.ticker);

      for (const bar of outcome.bars) {
        rows.push({
          ticker: outcome.ticker,
          date: bar.date,
          adj_close: bar.adjClose,
          volume: bar.volume,
        });
        // Merge into the panel, respecting the caller's window: the gap fetch
        // can legitimately return bars outside `range` at the boundaries.
        if (bar.date >= range.from && bar.date <= range.to) {
          (series[outcome.ticker] ??= []).push({
            ticker: outcome.ticker,
            date: bar.date,
            adjClose: bar.adjClose,
            volume: bar.volume,
          });
        }
      }
    }

    await upsertBars(rows);

    // Freshly merged tickers need re-sorting and de-duplication against what
    // the cache already held.
    for (const ticker of meta.fetched) {
      const merged = series[ticker];
      if (!merged) continue;
      const byDate = new Map(merged.map((bar) => [bar.date, bar]));
      series[ticker] = [...byDate.values()].sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
      );
    }
  }

  for (const ticker of requested) {
    const bars = series[ticker];
    if (!bars || bars.length === 0) {
      meta.empty.push(ticker);
      delete series[ticker];
    }
  }

  meta.totalMs = Date.now() - startedAt;
  return { series, meta };
}

/**
 * Convenience wrapper for the read-only path: never touches the external API.
 * Use from Server Components rendering cached analytics.
 */
export function getCachedDailyPrices(
  tickers: string[],
  range: DateRange,
): Promise<PricePanel> {
  return getDailyPrices(tickers, range, { allowFetch: false });
}
