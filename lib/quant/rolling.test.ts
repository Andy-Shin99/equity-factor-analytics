import { describe, expect, it } from "vitest";

import { DEFAULT_ROLLING_WINDOW, rollingFactorBetas, toRollingChartRows } from "./rolling";
import type { FactorKey, FactorObservation, ReturnSeries } from "@/types/domain";

const FACTORS: FactorKey[] = ["market_rf", "hml"];

/** Deterministic two-factor panel over `n` sequential dates. */
function panel(n: number): FactorObservation[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `d${String(i).padStart(4, "0")}`,
    values: {
      market_rf: 0.01 * Math.sin(i),
      smb: 0,
      hml: 0.008 * Math.cos(i / 3),
      quality: 0,
      momentum: 0,
      low_vol: 0,
    } as Record<FactorKey, number>,
  }));
}

/**
 * A portfolio whose market beta jumps from 0.5 to 1.5 halfway through — the
 * style-drift scenario the rolling window exists to expose.
 */
function driftingReturns(observations: FactorObservation[], breakAt: number): ReturnSeries {
  return {
    dates: observations.map((o) => o.date),
    values: observations.map((o, i) => {
      const beta = i < breakAt ? 0.5 : 1.5;
      return beta * o.values.market_rf + 0.4 * o.values.hml + 0.00001 * Math.sin(2.3 * i);
    }),
  };
}

describe("rollingFactorBetas", () => {
  const observations = panel(240);
  const returns = driftingReturns(observations, 120);
  const series = rollingFactorBetas(returns, observations, {
    window: 60,
    factors: FACTORS,
  });

  it("produces one point per window", () => {
    // 240 observations, window 60, step 1 -> 181 windows.
    expect(series.points).toHaveLength(240 - 60 + 1);
    expect(series.meta.windowsSkipped).toBe(0);
  });

  it("stamps each point with the window's last date", () => {
    const first = series.points[0];
    expect(first?.windowStart).toBe("d0000");
    expect(first?.date).toBe("d0059");
  });

  it("recovers the pre-drift beta in a fully pre-break window", () => {
    // Window ending at index 119 is entirely before the break.
    const point = series.points.find((p) => p.date === "d0119");
    expect(point?.betas.market_rf).toBeCloseTo(0.5, 2);
  });

  it("recovers the post-drift beta in a fully post-break window", () => {
    // Window ending at index 239 starts at 180, fully after the break.
    const point = series.points[series.points.length - 1];
    expect(point?.date).toBe("d0239");
    expect(point?.betas.market_rf).toBeCloseTo(1.5, 2);
  });

  it("shows the beta migrating across the break rather than jumping", () => {
    // A window straddling the break must land between the two regimes; this is
    // what makes drift visible instead of a single blended average.
    const straddling = series.points.find((p) => p.date === "d0149");
    const beta = straddling?.betas.market_rf ?? Number.NaN;
    expect(beta).toBeGreaterThan(0.5);
    expect(beta).toBeLessThan(1.5);
  });

  it("keeps the stable factor stable inside a single regime", () => {
    // Windows that straddle the break are genuinely misspecified: the market
    // beta changes mid-window, and that misfit leaks into the other loadings.
    // Only windows lying entirely within one regime should recover 0.4 — which
    // is also a reminder that a drift chart's non-drifting lines are unreliable
    // exactly where another factor is breaking.
    const endingBeforeBreak = series.points.slice(0, 61);
    const startingAfterBreak = series.points.slice(120);

    expect(endingBeforeBreak[endingBeforeBreak.length - 1]?.date).toBe("d0119");
    expect(startingAfterBreak[0]?.windowStart).toBe("d0120");

    for (const point of [...endingBeforeBreak, ...startingAfterBreak]) {
      expect(point.betas.hml).toBeCloseTo(0.4, 2);
    }
  });

  it("honours the step size", () => {
    const stepped = rollingFactorBetas(returns, observations, {
      window: 60,
      step: 20,
      factors: FACTORS,
    });
    expect(stepped.points.length).toBe(Math.floor((240 - 60) / 20) + 1);
    expect(stepped.meta.step).toBe(20);
  });

  it("defaults to the 60-day monitoring window", () => {
    expect(DEFAULT_ROLLING_WINDOW).toBe(60);
    const defaulted = rollingFactorBetas(returns, observations, { factors: FACTORS });
    expect(defaulted.meta.window).toBe(60);
  });

  it("returns no points when the sample is shorter than one window", () => {
    const short = panel(30);
    const result = rollingFactorBetas(driftingReturns(short, 15), short, {
      window: 60,
      factors: FACTORS,
    });
    expect(result.points).toEqual([]);
    expect(result.meta.alignedObservations).toBe(30);
  });

  it("skips a singular window instead of aborting the series", () => {
    // hml is constant here, so any window containing only that regime is
    // singular once market_rf is also flat.
    const flat: FactorObservation[] = Array.from({ length: 70 }, (_, i) => ({
      date: `d${String(i).padStart(4, "0")}`,
      values: {
        market_rf: 0.01,
        smb: 0,
        hml: 0.008,
        quality: 0,
        momentum: 0,
        low_vol: 0,
      } as Record<FactorKey, number>,
    }));
    const result = rollingFactorBetas(
      { dates: flat.map((o) => o.date), values: flat.map(() => 0.005) },
      flat,
      { window: 60, factors: FACTORS },
    );
    expect(result.meta.windowsAttempted).toBe(11);
    expect(result.meta.windowsSkipped).toBe(11);
    expect(result.points).toEqual([]);
  });

  it("rejects a window too small for the factor count", () => {
    expect(() =>
      rollingFactorBetas(returns, observations, { window: 3, factors: FACTORS }),
    ).toThrow(/window must be an integer of at least 4/);
  });

  it("rejects a non-positive step", () => {
    expect(() =>
      rollingFactorBetas(returns, observations, { step: 0, factors: FACTORS }),
    ).toThrow(/step must be a positive integer/);
  });
});

describe("toRollingChartRows", () => {
  it("emits one row per date keyed by factor label", () => {
    const observations = panel(70);
    const series = rollingFactorBetas(driftingReturns(observations, 35), observations, {
      window: 60,
      factors: FACTORS,
    });
    const rows = toRollingChartRows(series);
    expect(rows).toHaveLength(series.points.length);
    expect(Object.keys(rows[0] ?? {})).toEqual(["date", "Market", "Value"]);
  });
});
