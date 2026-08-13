import { describe, expect, it } from "vitest";

import {
  dedupeByKey,
  POSTGREST_MAX_ROWS,
  readAllPages,
  type PageFetcher,
} from "./pagination";

/**
 * Fake PostgREST: serves `total` synthetic rows and clamps every response to
 * `serverCap`, which is what Supabase actually does regardless of the requested
 * range.
 */
function fakeServer(total: number, serverCap = POSTGREST_MAX_ROWS) {
  const calls: Array<{ from: number; to: number; wantCount: boolean }> = [];

  const fetchPage: PageFetcher<{ id: number }> = async (from, to, wantCount) => {
    calls.push({ from, to, wantCount });
    const requested = to - from + 1;
    const size = Math.min(requested, serverCap, Math.max(0, total - from));
    return {
      rows: Array.from({ length: size }, (_, i) => ({ id: from + i })),
      total: wantCount ? total : null,
    };
  };

  return { fetchPage, calls };
}

describe("readAllPages", () => {
  it("returns everything in one request when the result fits a page", async () => {
    const { fetchPage, calls } = fakeServer(400);
    const { rows, requests } = await readAllPages(fetchPage);
    expect(rows).toHaveLength(400);
    expect(requests).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("asks for a count only on the first request", async () => {
    const { fetchPage, calls } = fakeServer(3500);
    await readAllPages(fetchPage);
    expect(calls.filter((c) => c.wantCount)).toHaveLength(1);
    expect(calls[0]?.wantCount).toBe(true);
  });

  it("reads every row across pages, in order", async () => {
    const { fetchPage } = fakeServer(3500);
    const { rows, requests } = await readAllPages(fetchPage);
    expect(rows).toHaveLength(3500);
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 3500 }, (_, i) => i));
    expect(requests).toBe(4);
  });

  it("handles a total that is an exact multiple of the page size", async () => {
    // The off-by-one trap: 2000 rows is exactly 2 pages, not 3.
    const { fetchPage } = fakeServer(2000);
    const { rows, requests } = await readAllPages(fetchPage);
    expect(rows).toHaveLength(2000);
    expect(requests).toBe(2);
  });

  it("does NOT truncate when the server caps below the requested page size", async () => {
    // The regression this file exists for: requesting 5000 with a 1000-row
    // server cap must not be mistaken for "the last page".
    const { fetchPage } = fakeServer(3500, 1000);
    const { rows } = await readAllPages(fetchPage, { pageSize: 5000 });
    expect(rows).toHaveLength(3500);
  });

  it("clamps the page size to the server maximum", async () => {
    const { fetchPage, calls } = fakeServer(1500);
    await readAllPages(fetchPage, { pageSize: 99999 });
    expect(calls[0]?.to).toBe(POSTGREST_MAX_ROWS - 1);
  });

  it("falls back to sequential paging when no count is reported", async () => {
    const total = 2500;
    const calls: number[] = [];
    const fetchPage: PageFetcher<{ id: number }> = async (from, to) => {
      calls.push(from);
      const size = Math.min(to - from + 1, Math.max(0, total - from));
      return {
        rows: Array.from({ length: size }, (_, i) => ({ id: from + i })),
        total: null,
      };
    };

    const { rows } = await readAllPages(fetchPage);
    expect(rows).toHaveLength(total);
    expect(calls).toEqual([0, 1000, 2000]);
  });

  it("terminates on an empty first page", async () => {
    const { fetchPage } = fakeServer(0);
    const { rows, requests } = await readAllPages(fetchPage);
    expect(rows).toEqual([]);
    expect(requests).toBe(1);
  });

  it("propagates a fetch error rather than returning a partial result", async () => {
    const fetchPage: PageFetcher<{ id: number }> = async (from) => {
      if (from > 0) throw new Error("page 2 exploded");
      return { rows: Array.from({ length: 1000 }, (_, i) => ({ id: i })), total: 2500 };
    };
    await expect(readAllPages(fetchPage)).rejects.toThrow("page 2 exploded");
  });
});

describe("dedupeByKey", () => {
  it("keeps the first occurrence of each key", () => {
    const rows = [
      { ticker: "AAPL", date: "d1", v: 1 },
      { ticker: "AAPL", date: "d1", v: 2 },
      { ticker: "AAPL", date: "d2", v: 3 },
    ];
    expect(dedupeByKey(rows, (r) => `${r.ticker}|${r.date}`)).toEqual([
      { ticker: "AAPL", date: "d1", v: 1 },
      { ticker: "AAPL", date: "d2", v: 3 },
    ]);
  });

  it("preserves order", () => {
    const rows = [{ id: "c" }, { id: "a" }, { id: "c" }, { id: "b" }];
    expect(dedupeByKey(rows, (r) => r.id).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("handles an empty input", () => {
    expect(dedupeByKey([], (r: { id: string }) => r.id)).toEqual([]);
  });
});
