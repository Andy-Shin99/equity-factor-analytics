/**
 * Yahoo Finance daily bar provider.
 *
 * Talks to the public `v8/finance/chart` endpoint directly with `fetch`.
 * This is the same endpoint the Python `yfinance` package wraps, so there is
 * no reason to introduce a second language for it (CLAUDE.md).
 *
 * Only used to fill gaps in the Supabase cache — never on a hot read path.
 */

/** One raw daily bar as returned by Yahoo, already normalised. */
export interface YahooDailyBar {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  adjClose: number;
  volume: number | null;
}

const CHART_ENDPOINT = "https://query1.finance.yahoo.com/v8/finance/chart";

/** Yahoo returns 403 to clients that send no browser-like User-Agent. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export class YahooFinanceError extends Error {
  constructor(
    message: string,
    readonly ticker: string,
  ) {
    super(message);
    this.name = "YahooFinanceError";
  }
}

// --- response narrowing ------------------------------------------------------
// The payload is untrusted JSON, so every level is checked before use rather
// than cast. A shape change upstream must fail loudly here, not produce
// `undefined` prices that silently poison the regression.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNumberArray(value: unknown): (number | null)[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
}

/**
 * Convert an epoch-second bar timestamp to its trading date.
 *
 * Yahoo stamps daily bars at the session open in UTC: 13:30/14:30 UTC for US
 * equities and 00:00 UTC for KRX (09:00 KST). In both cases the UTC calendar
 * date equals the local trading date, so a plain UTC slice is correct for the
 * S&P 500 and KOSPI 200 universes this project covers.
 */
export function tradingDateFromTimestamp(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * Parse a `v8/finance/chart` payload into normalised bars.
 *
 * Rows with a null adjusted close (trading halts, Yahoo gaps) are dropped —
 * a missing price is not a data point, and forward-filling it would fabricate
 * a 0% return.
 */
export function parseYahooChart(payload: unknown, ticker: string): YahooDailyBar[] {
  if (!isRecord(payload) || !isRecord(payload.chart)) {
    throw new YahooFinanceError("Unexpected payload: missing `chart`", ticker);
  }

  const { chart } = payload;

  if (isRecord(chart.error) && typeof chart.error.description === "string") {
    throw new YahooFinanceError(`Yahoo error: ${chart.error.description}`, ticker);
  }

  const result = Array.isArray(chart.result) ? chart.result[0] : undefined;
  if (!isRecord(result)) {
    // Yahoo returns result: null for unknown symbols.
    throw new YahooFinanceError("No result for symbol (delisted or invalid?)", ticker);
  }

  const timestamps = result.timestamp;
  if (!Array.isArray(timestamps)) {
    // A valid symbol with no bars in the requested window, e.g. a range that
    // predates the listing. Not an error.
    return [];
  }

  const indicators = isRecord(result.indicators) ? result.indicators : undefined;
  const adjCloseBlock = Array.isArray(indicators?.adjclose)
    ? indicators.adjclose[0]
    : undefined;
  const adjClose = isRecord(adjCloseBlock) ? asNumberArray(adjCloseBlock.adjclose) : null;

  if (!adjClose) {
    // Deliberately fatal. Falling back to the unadjusted close would silently
    // inject fake returns on every split and dividend date.
    throw new YahooFinanceError(
      "Payload has no adjusted close series; refusing to fall back to unadjusted close",
      ticker,
    );
  }

  const quoteBlock = Array.isArray(indicators?.quote) ? indicators.quote[0] : undefined;
  const volume = isRecord(quoteBlock) ? asNumberArray(quoteBlock.volume) : null;

  const bars: YahooDailyBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const price = adjClose[i];
    if (typeof ts !== "number" || price === null || price === undefined) continue;
    // The DB has a `check (adj_close > 0)` constraint; drop violators here so a
    // bad upstream row cannot fail the whole batch upsert.
    if (price <= 0) continue;

    bars.push({
      date: tradingDateFromTimestamp(ts),
      adjClose: price,
      volume: volume?.[i] ?? null,
    });
  }

  return bars;
}

/** Epoch seconds for the start of an ISO date in UTC. */
function toEpochSeconds(isoDate: string, endOfDay = false): number {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`Invalid ISO date: ${isoDate}`);
  return Math.floor(ms / 1000) + (endOfDay ? 86_400 : 0);
}

export function buildChartUrl(ticker: string, from: string, to: string): string {
  const params = new URLSearchParams({
    period1: String(toEpochSeconds(from)),
    period2: String(toEpochSeconds(to, true)),
    interval: "1d",
    // Required for `indicators.adjclose` to be present in the response.
    events: "div,split",
    includeAdjustedClose: "true",
  });
  return `${CHART_ENDPOINT}/${encodeURIComponent(ticker)}?${params.toString()}`;
}

/** Fetch daily adjusted bars for one ticker over an inclusive date range. */
export async function fetchYahooDailyBars(
  ticker: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<YahooDailyBar[]> {
  const response = await fetch(buildChartUrl(ticker, from, to), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    // Yahoo is the origin of truth for gaps; never serve a stale cached body.
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new YahooFinanceError(
      `HTTP ${response.status} ${response.statusText}`,
      ticker,
    );
  }

  return parseYahooChart(await response.json(), ticker);
}
