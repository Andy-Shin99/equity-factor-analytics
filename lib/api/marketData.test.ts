import { describe, expect, it } from "vitest";

import {
  addDays,
  chunk,
  computeFetchRange,
  coverageOf,
  dedupeRows,
  groupByTicker,
  mapWithConcurrency,
  normalizeTicker,
  rowToBar,
} from "./marketData";
import type { DailyPriceRow } from "@/types/database";

const RANGE = { from: "2024-01-01", to: "2024-06-28" };
const TODAY = "2024-06-28";
const TOLERANCE = 4;

describe("addDays", () => {
  it("moves forward and backward across month boundaries", () => {
    expect(addDays("2024-02-28", 2)).toBe("2024-03-01"); // leap year
    expect(addDays("2024-01-01", -1)).toBe("2023-12-31");
  });

  it("rejects a malformed date instead of producing NaN", () => {
    expect(() => addDays("not-a-date", 1)).toThrow(/Invalid ISO date/);
  });
});

describe("normalizeTicker", () => {
  it("trims and upper-cases", () => {
    expect(normalizeTicker("  aapl ")).toBe("AAPL");
    expect(normalizeTicker("005930.ks")).toBe("005930.KS");
  });
});

describe("computeFetchRange", () => {
  it("requests the whole window when nothing is cached", () => {
    expect(computeFetchRange(null, RANGE, TODAY, TOLERANCE)).toEqual(RANGE);
  });

  it("returns null when cached coverage spans the window", () => {
    const coverage = { first: "2023-12-01", last: "2024-06-27" };
    expect(computeFetchRange(coverage, RANGE, TODAY, TOLERANCE)).toBeNull();
  });

  it("tolerates a weekend-plus-holiday tail gap without refetching", () => {
    // 4 days stale, exactly at the tolerance boundary.
    const coverage = { first: "2023-12-01", last: "2024-06-24" };
    expect(computeFetchRange(coverage, RANGE, TODAY, TOLERANCE)).toBeNull();
  });

  it("fetches only the tail when history is complete but data is stale", () => {
    const coverage = { first: "2023-12-01", last: "2024-05-01" };
    expect(computeFetchRange(coverage, RANGE, TODAY, TOLERANCE)).toEqual({
      from: "2024-05-02",
      to: RANGE.to,
    });
  });

  it("refetches the whole window when leading history is missing", () => {
    // One request covers both the head gap and the tail, instead of two.
    const coverage = { first: "2024-03-01", last: "2024-05-01" };
    expect(computeFetchRange(coverage, RANGE, TODAY, TOLERANCE)).toEqual(RANGE);
  });

  it("does not chase a leading gap inside the tolerance (holiday at window start)", () => {
    // 2024-01-01 was a market holiday, so the first cached bar is the 2nd.
    // An exact date comparison would refetch this symbol on every request.
    const coverage = { first: "2024-01-02", last: "2024-06-27" };
    expect(computeFetchRange(coverage, RANGE, TODAY, TOLERANCE)).toBeNull();
  });

  it("does not treat a historical window as stale just because it ended long ago", () => {
    // A 2020 backtest window is fully cached; `today` must not make it stale.
    const historical = { from: "2020-01-01", to: "2020-12-31" };
    const coverage = { first: "2020-01-02", last: "2020-12-30" };
    expect(computeFetchRange(coverage, historical, TODAY, TOLERANCE)).toBeNull();
  });

  it("clamps staleness to today when the window extends into the future", () => {
    const future = { from: "2024-01-01", to: "2024-12-31" };
    const coverage = { first: "2023-12-01", last: "2024-06-27" };
    expect(computeFetchRange(coverage, future, TODAY, TOLERANCE)).toBeNull();
  });
});

describe("groupByTicker / coverageOf", () => {
  const bars = [
    { ticker: "MSFT", date: "2024-01-03", adjClose: 3, volume: null },
    { ticker: "AAPL", date: "2024-01-02", adjClose: 2, volume: 10 },
    { ticker: "AAPL", date: "2024-01-01", adjClose: 1, volume: 20 },
  ];

  it("groups and sorts ascending by date", () => {
    const grouped = groupByTicker(bars);
    expect(Object.keys(grouped).sort()).toEqual(["AAPL", "MSFT"]);
    expect(grouped.AAPL?.map((b) => b.date)).toEqual(["2024-01-01", "2024-01-02"]);
  });

  it("derives coverage from sorted bars", () => {
    expect(coverageOf(groupByTicker(bars).AAPL)).toEqual({
      first: "2024-01-01",
      last: "2024-01-02",
    });
  });

  it("returns null coverage for an absent or empty series", () => {
    expect(coverageOf(undefined)).toBeNull();
    expect(coverageOf([])).toBeNull();
  });
});

describe("rowToBar", () => {
  it("coerces postgres numerics to numbers", () => {
    const row = {
      ticker: "AAPL",
      date: "2024-01-02",
      adj_close: 185.64,
      volume: null,
    } satisfies DailyPriceRow;

    expect(rowToBar(row)).toEqual({
      ticker: "AAPL",
      date: "2024-01-02",
      adjClose: 185.64,
      volume: null,
    });
  });
});

describe("dedupeRows", () => {
  it("keeps the last row per (ticker, date)", () => {
    // Postgres rejects an upsert batch touching the same PK twice.
    const rows: DailyPriceRow[] = [
      { ticker: "AAPL", date: "2024-01-02", adj_close: 1, volume: null },
      { ticker: "AAPL", date: "2024-01-02", adj_close: 2, volume: null },
      { ticker: "MSFT", date: "2024-01-02", adj_close: 3, volume: null },
    ];
    const deduped = dedupeRows(rows);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((r) => r.ticker === "AAPL")?.adj_close).toBe(2);
  });
});

describe("chunk", () => {
  it("splits into batches without dropping the remainder", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order in the results", async () => {
    const items = [5, 1, 4, 2, 3];
    const results = await mapWithConcurrency(items, 2, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, n));
      return n * 10;
    });
    expect(results).toEqual([50, 10, 40, 20, 30]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles a limit larger than the input", async () => {
    expect(await mapWithConcurrency([1], 8, async (n) => n)).toEqual([1]);
  });
});
