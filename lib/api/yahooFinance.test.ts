import { describe, expect, it } from "vitest";

import {
  buildChartUrl,
  parseYahooChart,
  tradingDateFromTimestamp,
  YahooFinanceError,
} from "./yahooFinance";

/** Minimal well-formed payload builder. */
function chartPayload(options: {
  timestamps?: unknown;
  adjclose?: unknown;
  volume?: unknown;
  omitAdjclose?: boolean;
}) {
  const indicators: Record<string, unknown> = {
    quote: [{ volume: options.volume ?? [1000, 2000] }],
  };
  if (!options.omitAdjclose) {
    indicators.adjclose = [{ adjclose: options.adjclose ?? [100, 101] }];
  }
  return {
    chart: {
      error: null,
      result: [
        {
          meta: { symbol: "AAPL" },
          timestamp: options.timestamps ?? [1_700_000_000, 1_700_086_400],
          indicators,
        },
      ],
    },
  };
}

describe("tradingDateFromTimestamp", () => {
  it("maps a US session open (13:30 UTC) to that calendar date", () => {
    // 2024-01-16T14:30:00Z
    expect(tradingDateFromTimestamp(1_705_415_400)).toBe("2024-01-16");
  });

  it("maps a KRX session open (00:00 UTC) to that calendar date", () => {
    // 2024-01-16T00:00:00Z — 09:00 KST
    expect(tradingDateFromTimestamp(1_705_363_200)).toBe("2024-01-16");
  });
});

describe("parseYahooChart", () => {
  it("returns normalised bars", () => {
    const bars = parseYahooChart(chartPayload({}), "AAPL");
    expect(bars).toHaveLength(2);
    expect(bars[0]).toEqual({
      date: tradingDateFromTimestamp(1_700_000_000),
      adjClose: 100,
      volume: 1000,
    });
  });

  it("drops bars whose adjusted close is null (halts / upstream gaps)", () => {
    const bars = parseYahooChart(chartPayload({ adjclose: [100, null] }), "AAPL");
    expect(bars).toHaveLength(1);
    expect(bars[0]?.adjClose).toBe(100);
  });

  it("drops non-positive prices so the adj_close > 0 constraint cannot fail a batch", () => {
    const bars = parseYahooChart(chartPayload({ adjclose: [0, -5] }), "AAPL");
    expect(bars).toEqual([]);
  });

  it("keeps the bar but nulls volume when volume is missing", () => {
    const bars = parseYahooChart(chartPayload({ volume: [null, null] }), "AAPL");
    expect(bars).toHaveLength(2);
    expect(bars[0]?.volume).toBeNull();
  });

  it("refuses to fall back to unadjusted close", () => {
    // Silently using `close` would inject a fake return on every split date.
    expect(() => parseYahooChart(chartPayload({ omitAdjclose: true }), "AAPL")).toThrow(
      YahooFinanceError,
    );
  });

  it("surfaces a Yahoo-reported error", () => {
    const payload = {
      chart: { error: { description: "No data found, symbol may be delisted" }, result: null },
    };
    expect(() => parseYahooChart(payload, "BADSYM")).toThrow(/delisted/);
  });

  it("throws on an unknown symbol (result: null)", () => {
    expect(() => parseYahooChart({ chart: { error: null, result: null } }, "NOPE")).toThrow(
      YahooFinanceError,
    );
  });

  it("throws when the payload shape is not a chart response", () => {
    expect(() => parseYahooChart({ unexpected: true }, "AAPL")).toThrow(/missing `chart`/);
  });

  it("returns an empty array for a valid symbol with no bars in the window", () => {
    const payload = { chart: { error: null, result: [{ meta: {}, indicators: {} }] } };
    expect(parseYahooChart(payload, "AAPL")).toEqual([]);
  });
});

describe("buildChartUrl", () => {
  it("requests adjusted closes over an inclusive range", () => {
    const url = new URL(buildChartUrl("AAPL", "2024-01-01", "2024-01-31"));
    const params = url.searchParams;

    expect(url.pathname.endsWith("/AAPL")).toBe(true);
    expect(params.get("interval")).toBe("1d");
    expect(params.get("includeAdjustedClose")).toBe("true");
    // period2 must cover the whole final day, or `to` is silently excluded.
    expect(Number(params.get("period2")) - Number(params.get("period1"))).toBe(31 * 86_400);
  });

  it("escapes suffixed KRX symbols", () => {
    expect(buildChartUrl("005930.KS", "2024-01-01", "2024-01-02")).toContain("005930.KS");
  });
});
