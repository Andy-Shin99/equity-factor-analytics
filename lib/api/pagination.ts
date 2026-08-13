import { mapWithConcurrency } from "./concurrency";

/**
 * Paginated reads against PostgREST.
 *
 * WHY THIS EXISTS
 *
 * Supabase caps a single response at 1000 rows (`db-max-rows`), verified against
 * this project: requesting 100000 still returns exactly 1000. An 11-ticker,
 * 4-year price panel is ~12700 rows, so it takes 13 requests no matter how the
 * page size is set — and read serially from Korea that measured ~1.4s, i.e. 13
 * round trips at ~110ms each.
 *
 * So: ask for the exact row count on the first page, then fetch the remaining
 * pages CONCURRENTLY. Wall clock becomes roughly ceil(pages / concurrency)
 * round trips instead of `pages`.
 *
 * The termination rule is also load-bearing. A loop that stops when a page comes
 * back shorter than the requested size silently truncates the moment anyone sets
 * a page size above the server cap: the first page returns 1000 of a requested
 * 5000 and the loop exits, dropping the rest without an error. Paging here is
 * driven by the reported total, with a sequential "until empty" fallback.
 */

/** Hard server-side ceiling; requesting more is silently clamped. */
export const POSTGREST_MAX_ROWS = 1000;

/** Enough to collapse a decade-long panel into ~2 waves, gentle on the pooler. */
export const DEFAULT_PAGE_CONCURRENCY = 8;

export interface PageResult<T> {
  rows: T[];
  /** Total matching rows, when the caller asked for a count. */
  total: number | null;
}

/**
 * Fetch one page. `wantCount` is true only for the first call, so the extra
 * COUNT is paid once per read rather than once per page.
 */
export type PageFetcher<T> = (
  from: number,
  to: number,
  wantCount: boolean,
) => Promise<PageResult<T>>;

export interface ReadAllPagesOptions {
  pageSize?: number;
  concurrency?: number;
}

export interface ReadAllPagesResult<T> {
  rows: T[];
  /** Number of HTTP requests issued — surfaced so latency work has a metric. */
  requests: number;
}

export async function readAllPages<T>(
  fetchPage: PageFetcher<T>,
  options: ReadAllPagesOptions = {},
): Promise<ReadAllPagesResult<T>> {
  const pageSize = Math.min(
    Math.max(1, options.pageSize ?? POSTGREST_MAX_ROWS),
    POSTGREST_MAX_ROWS,
  );
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_PAGE_CONCURRENCY);

  const first = await fetchPage(0, pageSize - 1, true);
  if (first.rows.length < pageSize) {
    return { rows: first.rows, requests: 1 };
  }

  const total = first.total;

  if (total === null || !Number.isFinite(total) || total <= 0) {
    // No usable count: page sequentially until a short page. Correct because the
    // page size never exceeds the server cap.
    const rows = [...first.rows];
    let requests = 1;
    for (let offset = rows.length; ; offset += pageSize) {
      const page = await fetchPage(offset, offset + pageSize - 1, false);
      requests++;
      rows.push(...page.rows);
      if (page.rows.length < pageSize) break;
    }
    return { rows, requests };
  }

  const pageCount = Math.ceil(total / pageSize);
  const laterPages = Array.from({ length: pageCount - 1 }, (_, i) => i + 1);

  const pages = await mapWithConcurrency(laterPages, concurrency, async (index) => {
    const from = index * pageSize;
    const page = await fetchPage(from, from + pageSize - 1, false);
    return page.rows;
  });

  return { rows: [...first.rows, ...pages.flat()], requests: pageCount };
}

/**
 * Drop duplicates by primary key, keeping the first occurrence.
 *
 * Necessary because the pages are read in separate requests: a concurrent insert
 * between them shifts every later offset, which can repeat or skip a row. Keying
 * on the primary key makes the assembled result correct regardless of what the
 * backfill job is doing at the same moment.
 */
export function dedupeByKey<T>(rows: readonly T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const id = key(row);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}
