import { describe, expect, it } from "vitest";

import { alignFactorData, runFactorRegression } from "./factorModel";
import { TRADING_DAYS_PER_YEAR } from "./risk";
import { FACTOR_KEYS, type FactorKey, type FactorObservation } from "@/types/domain";

/** Deterministic factor panel — no Math.random, so failures are reproducible. */
function syntheticFactors(n: number, offset = 0): FactorObservation[] {
  return Array.from({ length: n }, (_, i) => {
    const t = i + offset;
    return {
      date: `2024-${String(Math.floor(t / 28) + 1).padStart(2, "0")}-${String((t % 28) + 1).padStart(2, "0")}`,
      values: {
        market_rf: 0.0100 * Math.sin(t),
        smb: 0.0080 * Math.cos(t / 2),
        hml: 0.0060 * Math.sin(t / 3),
        quality: 0.0050 * Math.cos(t / 5),
        momentum: 0.0070 * Math.sin(t / 7),
        low_vol: 0.0040 * Math.cos(t / 11),
      } as Record<FactorKey, number>,
    };
  });
}

const TRUE_ALPHA = 0.0002;
const TRUE_BETAS: Record<FactorKey, number> = {
  market_rf: 1.2,
  smb: -0.3,
  hml: 0.5,
  quality: 0,
  momentum: 0,
  low_vol: 0,
};

/** y = alpha + B'F + small deterministic residual. */
function syntheticReturns(observations: FactorObservation[]) {
  return {
    dates: observations.map((o) => o.date),
    values: observations.map((o, i) => {
      let value = TRUE_ALPHA;
      for (const key of FACTOR_KEYS) value += TRUE_BETAS[key] * o.values[key];
      return value + 0.00002 * Math.sin(1.7 * i);
    }),
  };
}

describe("alignFactorData", () => {
  it("intersects on dates, not position", () => {
    const observations = syntheticFactors(5);
    const returns = {
      dates: [observations[1]!.date, observations[3]!.date, "1999-01-01"],
      values: [0.01, 0.02, 0.03],
    };
    const aligned = alignFactorData(returns, observations, ["market_rf"]);
    expect(aligned.dates).toEqual([observations[1]!.date, observations[3]!.date]);
    expect(aligned.y).toEqual([0.01, 0.02]);
    expect(aligned.X[0]?.[0]).toBeCloseTo(observations[1]!.values.market_rf, 12);
  });

  it("emits X columns in the requested factor order", () => {
    const observations = syntheticFactors(3);
    const returns = syntheticReturns(observations);
    const aligned = alignFactorData(returns, observations, ["hml", "market_rf"]);
    expect(aligned.X[0]?.[0]).toBeCloseTo(observations[0]!.values.hml, 12);
    expect(aligned.X[0]?.[1]).toBeCloseTo(observations[0]!.values.market_rf, 12);
  });
});

describe("runFactorRegression", () => {
  const observations = syntheticFactors(120);
  const portfolio = syntheticReturns(observations);
  const result = runFactorRegression(portfolio, observations);

  it("recovers the true betas", () => {
    for (const beta of result.betas) {
      expect(beta.estimate).toBeCloseTo(TRUE_BETAS[beta.factor], 2);
    }
  });

  it("recovers the true daily alpha", () => {
    expect(result.alpha.daily).toBeCloseTo(TRUE_ALPHA, 4);
  });

  it("annualises alpha arithmetically (x 252)", () => {
    expect(result.alpha.annualized).toBeCloseTo(result.alpha.daily * TRADING_DAYS_PER_YEAR, 12);
  });

  it("reports a near-perfect but non-degenerate fit", () => {
    expect(result.rSquared).toBeGreaterThan(0.99);
    expect(result.degenerate).toBe(false);
  });

  it("labels betas for the UI", () => {
    expect(result.betas.map((b) => b.label)).toEqual([
      "Market",
      "Size",
      "Value",
      "Quality",
      "Momentum",
      "Low Vol",
    ]);
  });

  it("finds the zero-loading factors statistically insignificant", () => {
    const quality = result.betas.find((b) => b.factor === "quality");
    expect(quality?.pValue).toBeGreaterThan(0.05);
  });

  it("finds the loaded factors highly significant", () => {
    const market = result.betas.find((b) => b.factor === "market_rf");
    expect(market?.pValue).toBeLessThan(1e-6);
    expect(Math.abs(market?.tStat ?? 0)).toBeGreaterThan(10);
  });

  it("annualises residual volatility", () => {
    expect(result.residualVolatilityAnnualized).toBeCloseTo(
      result.fit.residualStandardError * Math.sqrt(TRADING_DAYS_PER_YEAR),
      12,
    );
  });

  it("flags a raw intercept when no risk-free rate is supplied", () => {
    // Calling a raw intercept "alpha" overstates skill by about the cash rate.
    expect(result.riskAdjusted).toBe(false);
    expect(runFactorRegression(portfolio, observations, { riskFree: 0.0001 }).riskAdjusted).toBe(
      true,
    );
  });

  it("shifts alpha by exactly the risk-free rate", () => {
    const adjusted = runFactorRegression(portfolio, observations, { riskFree: 0.0001 });
    expect(adjusted.alpha.daily).toBeCloseTo(result.alpha.daily - 0.0001, 10);
  });

  it("honours a factor subset", () => {
    const subset = runFactorRegression(portfolio, observations, {
      factors: ["market_rf", "hml"],
    });
    expect(subset.betas).toHaveLength(2);
    expect(subset.df).toBe(subset.observations - 3);
  });

  it("explains the problem when factor coverage is too thin", () => {
    expect(() => runFactorRegression(portfolio, syntheticFactors(4))).toThrow(
      /factor_returns is populated/,
    );
  });

  it("rejects an empty factor list", () => {
    expect(() => runFactorRegression(portfolio, observations, { factors: [] })).toThrow(
      /At least one factor/,
    );
  });
});
