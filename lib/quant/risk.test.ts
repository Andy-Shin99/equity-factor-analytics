import { describe, expect, it } from "vitest";

import {
  annualizedGeometricReturn,
  annualizedReturn,
  annualizedVolatility,
  conditionalValueAtRisk,
  cumulativeReturn,
  historicalValueAtRisk,
  informationRatio,
  informationRatioFromActive,
  maxDrawdown,
  percentile,
  sampleStandardDeviation,
  sampleVariance,
  sharpeRatio,
  summarizeRisk,
  TRADING_DAYS_PER_YEAR,
  trackingError,
  trackingErrorFromActive,
} from "./risk";

const SQRT_252 = Math.sqrt(TRADING_DAYS_PER_YEAR);

describe("sampleVariance / sampleStandardDeviation", () => {
  it("uses the N-1 denominator", () => {
    // Classic set: population variance 4, sample variance 32/7.
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(sampleVariance(values)).toBeCloseTo(32 / 7, 12);
    expect(sampleStandardDeviation(values)).toBeCloseTo(Math.sqrt(32 / 7), 12);
  });

  it("is zero for a constant series", () => {
    expect(sampleVariance([3, 3, 3])).toBe(0);
  });

  it("refuses a single observation", () => {
    expect(() => sampleVariance([1])).toThrow(/at least 2/);
  });
});

describe("annualisation", () => {
  it("scales returns by 252 and volatility by sqrt(252)", () => {
    const daily = [0.01, -0.005, 0.002, 0.003];
    expect(annualizedReturn(daily)).toBeCloseTo(((0.01 - 0.005 + 0.002 + 0.003) / 4) * 252, 12);
    expect(annualizedVolatility(daily)).toBeCloseTo(sampleStandardDeviation(daily) * SQRT_252, 12);
  });

  it("compounds the cumulative return", () => {
    expect(cumulativeReturn([0.1, -0.1])).toBeCloseTo(1.1 * 0.9 - 1, 12);
    expect(cumulativeReturn([])).toBe(0);
  });

  it("computes CAGR over exactly one year of data", () => {
    const daily = new Array<number>(252).fill(0.001);
    expect(annualizedGeometricReturn(daily)).toBeCloseTo(1.001 ** 252 - 1, 10);
  });

  it("returns -1 for a total wipeout rather than NaN", () => {
    expect(annualizedGeometricReturn([-1, 0.5])).toBe(-1);
  });
});

describe("trackingError", () => {
  // active = [0.01, -0.01, 0.02, 0.00], mean 0.005
  // SUM (D - Dbar)^2 = 0.0005 -> /3 -> sqrt -> x sqrt(252)
  const portfolio = { dates: ["d1", "d2", "d3", "d4"], values: [0.02, 0.0, 0.03, 0.01] };
  const benchmark = { dates: ["d1", "d2", "d3", "d4"], values: [0.01, 0.01, 0.01, 0.01] };

  it("matches the hand-computed SKILL.md formula", () => {
    expect(trackingError(portfolio, benchmark)).toBeCloseTo(0.204939, 5);
  });

  it("subtracts the mean active return, so constant outperformance has zero TE", () => {
    // This is the discriminating test between the correct formula and a
    // root-mean-square of active returns, which would report 0.01 * sqrt(252).
    const steady = { dates: ["d1", "d2", "d3"], values: [0.02, 0.02, 0.02] };
    const flat = { dates: ["d1", "d2", "d3"], values: [0.01, 0.01, 0.01] };
    expect(trackingError(steady, flat)).toBeCloseTo(0, 12);
  });

  it("only uses dates the two series share", () => {
    const shorter = { dates: ["d1", "d2"], values: [0.01, 0.01] };
    expect(trackingErrorFromActive([0.01, -0.01])).toBeGreaterThan(0);
    expect(trackingError(portfolio, shorter)).toBeCloseTo(
      trackingErrorFromActive([0.01, -0.01]),
      12,
    );
  });
});

describe("informationRatio", () => {
  it("divides annualised active return by tracking error", () => {
    const portfolio = { dates: ["d1", "d2", "d3", "d4"], values: [0.02, 0.0, 0.03, 0.01] };
    const benchmark = { dates: ["d1", "d2", "d3", "d4"], values: [0.01, 0.01, 0.01, 0.01] };
    // 0.005 * 252 / 0.204939
    expect(informationRatio(portfolio, benchmark)).toBeCloseTo(6.14818, 4);
  });

  it("is NaN when tracking error is zero, not Infinity", () => {
    // A portfolio that never deviates has an undefined IR.
    expect(informationRatioFromActive([0.001, 0.001, 0.001])).toBeNaN();
  });
});

describe("sharpeRatio", () => {
  it("annualises excess return over volatility", () => {
    const daily = [0.01, -0.005, 0.002, 0.003];
    const expected = annualizedReturn(daily) / annualizedVolatility(daily);
    expect(sharpeRatio(daily, 0)).toBeCloseTo(expected, 10);
  });

  it("is NaN for a zero-volatility series", () => {
    expect(sharpeRatio([0.001, 0.001], 0)).toBeNaN();
  });
});

describe("percentile", () => {
  it("interpolates linearly between order statistics", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 12);
    expect(percentile([1, 2, 3], 0.5)).toBeCloseTo(2, 12);
  });

  it("returns the endpoints at 0 and 1", () => {
    expect(percentile([1, 2, 3], 0)).toBe(1);
    expect(percentile([1, 2, 3], 1)).toBe(3);
  });

  it("handles a single observation", () => {
    expect(percentile([7], 0.05)).toBe(7);
  });
});

describe("historicalValueAtRisk", () => {
  // n = 11, so the 5% position is 0.05 * 10 = 0.5: halfway between the two
  // worst days, -0.10 and -0.08.
  const returns = [-0.1, -0.08, -0.02, -0.01, 0, 0.01, 0.01, 0.02, 0.03, 0.04, 0.05];

  it("takes the 5th percentile at 95% confidence", () => {
    const var95 = historicalValueAtRisk(returns, 0.95);
    expect(var95.quantile).toBeCloseTo(-0.09, 12);
    expect(var95.valueAtRisk).toBeCloseTo(0.09, 12);
    expect(var95.confidence).toBe(0.95);
  });

  it("reports the loss as a positive magnitude", () => {
    expect(historicalValueAtRisk(returns).valueAtRisk).toBeGreaterThan(0);
  });

  it("does not depend on input order", () => {
    const shuffled = [...returns].reverse();
    expect(historicalValueAtRisk(shuffled).quantile).toBeCloseTo(
      historicalValueAtRisk(returns).quantile,
      12,
    );
  });

  it("rejects an out-of-range confidence level", () => {
    expect(() => historicalValueAtRisk(returns, 0)).toThrow();
    expect(() => historicalValueAtRisk(returns, 1)).toThrow();
  });
});

describe("conditionalValueAtRisk", () => {
  it("averages the tail beyond the VaR quantile", () => {
    const returns = [-0.1, -0.08, -0.02, -0.01, 0, 0.01, 0.01, 0.02, 0.03, 0.04, 0.05];
    // Only -0.10 sits at or below the -0.09 quantile.
    expect(conditionalValueAtRisk(returns, 0.95)).toBeCloseTo(0.1, 12);
  });

  it("is at least as large as VaR", () => {
    const returns = [-0.2, -0.1, -0.05, 0, 0.01, 0.02, 0.03, 0.04];
    const { valueAtRisk } = historicalValueAtRisk(returns, 0.95);
    expect(conditionalValueAtRisk(returns, 0.95)).toBeGreaterThanOrEqual(valueAtRisk - 1e-12);
  });
});

describe("maxDrawdown", () => {
  it("finds the peak-to-trough decline with dates", () => {
    // wealth = 1.1, 0.55, 0.66 -> worst drawdown 50% from d1 to d2
    const series = { dates: ["d1", "d2", "d3"], values: [0.1, -0.5, 0.2] };
    const result = maxDrawdown(series);
    expect(result.maxDrawdown).toBeCloseTo(0.5, 12);
    expect(result.peakDate).toBe("d1");
    expect(result.troughDate).toBe("d2");
    expect(result.durationDays).toBe(1);
  });

  it("measures from the window start when the series falls immediately", () => {
    // The running peak begins at 1.0, so a day-one loss is a real drawdown.
    const series = { dates: ["d1", "d2"], values: [-0.2, 0.1] };
    const result = maxDrawdown(series);
    expect(result.maxDrawdown).toBeCloseTo(0.2, 12);
    expect(result.peakDate).toBeNull();
    expect(result.troughDate).toBe("d1");
  });

  it("is zero for a monotonically rising series", () => {
    const result = maxDrawdown({ dates: ["d1", "d2"], values: [0.01, 0.01] });
    expect(result.maxDrawdown).toBe(0);
    expect(result.troughDate).toBeNull();
  });

  it("is zero for an empty series", () => {
    expect(maxDrawdown({ dates: [], values: [] }).maxDrawdown).toBe(0);
  });
});

describe("summarizeRisk", () => {
  const portfolio = {
    dates: ["d1", "d2", "d3", "d4"],
    values: [0.02, -0.01, 0.03, 0.01],
  };
  const benchmark = {
    dates: ["d1", "d2", "d3", "d4"],
    values: [0.01, 0.01, 0.01, 0.01],
  };

  it("fills every KPI when a benchmark is supplied", () => {
    const summary = summarizeRisk(portfolio, benchmark);
    expect(summary.observations).toBe(4);
    expect(summary.trackingError).not.toBeNull();
    expect(summary.informationRatio).not.toBeNull();
    expect(summary.activeReturn).toBeCloseTo(annualizedReturn([0.01, -0.02, 0.02, 0]), 12);
  });

  it("leaves benchmark-relative metrics null without a benchmark", () => {
    const summary = summarizeRisk(portfolio);
    expect(summary.trackingError).toBeNull();
    expect(summary.informationRatio).toBeNull();
    expect(summary.activeReturn).toBeNull();
    expect(summary.annualizedVolatility).toBeGreaterThan(0);
  });
});
