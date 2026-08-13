import { describe, expect, it } from "vitest";

import {
  activeReturns,
  alignSeries,
  buildPortfolioReturns,
  excessReturns,
  toReturnSeries,
  wealthIndex,
} from "./returns";
import type { PriceBar } from "@/types/domain";

function bars(ticker: string, entries: Array<[string, number]>): PriceBar[] {
  return entries.map(([date, adjClose]) => ({ ticker, date, adjClose, volume: null }));
}

describe("toReturnSeries", () => {
  const series = toReturnSeries(
    bars("AAPL", [
      ["2024-01-02", 100],
      ["2024-01-03", 110],
      ["2024-01-04", 99],
    ]),
  );

  it("computes simple returns", () => {
    expect(series.values[0]).toBeCloseTo(0.1, 12);
    expect(series.values[1]).toBeCloseTo(-0.1, 12);
  });

  it("stamps each return with the date of the LATER price", () => {
    // Off-by-one here shifts the whole regression by a day.
    expect(series.dates).toEqual(["2024-01-03", "2024-01-04"]);
  });

  it("yields nothing from a single bar", () => {
    expect(toReturnSeries(bars("AAPL", [["2024-01-02", 100]])).values).toEqual([]);
  });

  it("yields nothing from an empty series", () => {
    expect(toReturnSeries([]).dates).toEqual([]);
  });
});

describe("alignSeries", () => {
  it("keeps only shared dates, in the order of the first series", () => {
    const a = { dates: ["d1", "d2", "d3"], values: [1, 2, 3] };
    const b = { dates: ["d2", "d3", "d4"], values: [20, 30, 40] };
    expect(alignSeries(a, b)).toEqual({ dates: ["d2", "d3"], a: [2, 3], b: [20, 30] });
  });

  it("returns nothing when there is no overlap", () => {
    const a = { dates: ["d1"], values: [1] };
    const b = { dates: ["d2"], values: [2] };
    expect(alignSeries(a, b).dates).toEqual([]);
  });
});

describe("activeReturns", () => {
  it("subtracts the benchmark on shared dates only", () => {
    const portfolio = { dates: ["d1", "d2", "d3"], values: [0.02, 0.01, -0.01] };
    const benchmark = { dates: ["d2", "d3"], values: [0.005, -0.02] };
    const active = activeReturns(portfolio, benchmark);
    expect(active.dates).toEqual(["d2", "d3"]);
    expect(active.values[0]).toBeCloseTo(0.005, 12);
    expect(active.values[1]).toBeCloseTo(0.01, 12);
  });
});

describe("excessReturns", () => {
  it("subtracts a constant daily risk-free rate", () => {
    const series = { dates: ["d1", "d2"], values: [0.01, 0.02] };
    expect(excessReturns(series, 0.0001).values[0]).toBeCloseTo(0.0099, 12);
  });

  it("subtracts a date-matched risk-free series", () => {
    const series = { dates: ["d1", "d2"], values: [0.01, 0.02] };
    const rf = { dates: ["d2"], values: [0.0002] };
    const excess = excessReturns(series, rf);
    expect(excess.dates).toEqual(["d2"]);
    expect(excess.values[0]).toBeCloseTo(0.0198, 12);
  });
});

describe("buildPortfolioReturns", () => {
  const panel = {
    AAPL: bars("AAPL", [
      ["2024-01-02", 100],
      ["2024-01-03", 110], // +10%
      ["2024-01-04", 110], //   0%
    ]),
    MSFT: bars("MSFT", [
      ["2024-01-02", 200],
      ["2024-01-03", 190], // -5%
      ["2024-01-04", 209], // +10%
    ]),
  };
  const holdings = [
    { ticker: "AAPL", weight: 0.5 },
    { ticker: "MSFT", weight: 0.5 },
  ];

  it("weights holdings on each date", () => {
    const { series } = buildPortfolioReturns(panel, holdings);
    expect(series.dates).toEqual(["2024-01-03", "2024-01-04"]);
    expect(series.values[0]).toBeCloseTo(0.5 * 0.1 + 0.5 * -0.05, 12);
    expect(series.values[1]).toBeCloseTo(0.5 * 0 + 0.5 * 0.1, 12);
  });

  it("drops a date where a holding has no return under the strict policy", () => {
    const partial = {
      ...panel,
      MSFT: bars("MSFT", [
        ["2024-01-02", 200],
        ["2024-01-03", 190],
      ]),
    };
    const { series, meta } = buildPortfolioReturns(partial, holdings);
    expect(series.dates).toEqual(["2024-01-03"]);
    expect(meta.datesDropped).toEqual(["2024-01-04"]);
    expect(meta.datesPartial).toEqual([]);
  });

  it("attributes dropped dates to the holding that caused them", () => {
    // A bare count is unattributable; the caller needs to know it was MSFT.
    const partial = {
      ...panel,
      MSFT: bars("MSFT", [
        ["2024-01-02", 200],
        ["2024-01-03", 190],
      ]),
    };
    const { meta } = buildPortfolioReturns(partial, holdings);
    expect(meta.coverageGaps).toEqual([{ ticker: "MSFT", missingDates: 1 }]);
  });

  it("reports no coverage gaps when every holding spans the window", () => {
    expect(buildPortfolioReturns(panel, holdings).meta.coverageGaps).toEqual([]);
  });

  it("ranks coverage gaps worst first", () => {
    const ragged = {
      AAPL: bars("AAPL", [
        ["2024-01-02", 100],
        ["2024-01-03", 110],
        ["2024-01-04", 110],
        ["2024-01-05", 111],
      ]),
      // Missing two of the union's return dates.
      MSFT: bars("MSFT", [
        ["2024-01-02", 200],
        ["2024-01-03", 190],
      ]),
      // Missing one.
      NVDA: bars("NVDA", [
        ["2024-01-02", 50],
        ["2024-01-03", 55],
        ["2024-01-04", 56],
      ]),
    };
    const { meta } = buildPortfolioReturns(ragged, [
      { ticker: "AAPL", weight: 0.34 },
      { ticker: "MSFT", weight: 0.33 },
      { ticker: "NVDA", weight: 0.33 },
    ]);
    expect(meta.coverageGaps).toEqual([
      { ticker: "MSFT", missingDates: 2 },
      { ticker: "NVDA", missingDates: 1 },
    ]);
  });

  it("still attributes gaps under the renormalise policy", () => {
    const partial = {
      ...panel,
      MSFT: bars("MSFT", [
        ["2024-01-02", 200],
        ["2024-01-03", 190],
      ]),
    };
    const { meta } = buildPortfolioReturns(partial, holdings, {
      missingDatePolicy: "renormalize",
    });
    expect(meta.datesPartial).toEqual(["2024-01-04"]);
    expect(meta.coverageGaps).toEqual([{ ticker: "MSFT", missingDates: 1 }]);
  });

  it("renormalises the available weights when asked, and reports the affected dates", () => {
    const partial = {
      ...panel,
      MSFT: bars("MSFT", [
        ["2024-01-02", 200],
        ["2024-01-03", 190],
      ]),
    };
    const { series, meta } = buildPortfolioReturns(partial, holdings, {
      missingDatePolicy: "renormalize",
    });
    expect(series.dates).toEqual(["2024-01-03", "2024-01-04"]);
    // Only AAPL exists on the 4th, so its weight is rescaled to 1.0.
    expect(series.values[1]).toBeCloseTo(0, 12);
    expect(meta.datesPartial).toEqual(["2024-01-04"]);
  });

  it("normalises weights that do not sum to one, and flags it", () => {
    const unnormalized = [
      { ticker: "AAPL", weight: 1 },
      { ticker: "MSFT", weight: 1 },
    ];
    const { series, meta } = buildPortfolioReturns(panel, unnormalized);
    expect(meta.weightSum).toBe(2);
    expect(meta.weightsNormalized).toBe(true);
    // Same as the 50/50 case after normalisation.
    expect(series.values[0]).toBeCloseTo(0.025, 12);
  });

  it("reports holdings that have no price history", () => {
    const { meta } = buildPortfolioReturns(panel, [
      ...holdings,
      { ticker: "MISSING", weight: 0 },
    ]);
    expect(meta.tickersMissing).toEqual(["MISSING"]);
  });

  it("throws when no holding has any history", () => {
    expect(() => buildPortfolioReturns({}, holdings)).toThrow(/No price history/);
  });

  it("throws on an empty or non-positive weight set", () => {
    expect(() => buildPortfolioReturns(panel, [])).toThrow(/no holdings/);
    expect(() =>
      buildPortfolioReturns(panel, [{ ticker: "AAPL", weight: 0 }]),
    ).toThrow(/positive total/);
  });
});

describe("wealthIndex", () => {
  it("compounds returns from 1.0", () => {
    expect(wealthIndex([0.1, -0.5])).toEqual([1.1, 1.1 * 0.5]);
  });

  it("is empty for no returns", () => {
    expect(wealthIndex([])).toEqual([]);
  });
});
