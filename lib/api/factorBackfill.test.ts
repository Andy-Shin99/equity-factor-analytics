import { describe, expect, it } from "vitest";

import { buildFactorRows } from "./factorBackfill";
import {
  FACTOR_DEFINITIONS,
  FACTOR_HISTORY_START,
  REQUIRED_TICKERS,
  RISK_FREE_PROXY,
} from "./factorDefinitions";
import type { ReturnSeries } from "@/types/domain";

const DATES = ["2024-01-02", "2024-01-03", "2024-01-04"];

function series(values: number[], dates: string[] = DATES): ReturnSeries {
  return { dates, values };
}

/** Every leg present on all three dates, with distinguishable values. */
function completePanel(): Record<string, ReturnSeries> {
  return {
    SPY: series([0.010, -0.005, 0.002]),
    BIL: series([0.0002, 0.0002, 0.0002]),
    IWM: series([0.015, -0.010, 0.004]),
    VTV: series([0.008, -0.003, 0.001]),
    VUG: series([0.012, -0.007, 0.003]),
    QUAL: series([0.011, -0.004, 0.002]),
    MTUM: series([0.014, -0.002, 0.005]),
    USMV: series([0.006, -0.001, 0.000]),
  };
}

describe("factor definitions", () => {
  it("covers every factor axis exactly once", () => {
    const keys = FACTOR_DEFINITIONS.map((d) => d.key);
    expect(keys).toEqual(["market_rf", "smb", "hml", "quality", "momentum", "low_vol"]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("derives the required ticker set without duplicates", () => {
    expect(REQUIRED_TICKERS).toEqual(["SPY", "BIL", "IWM", "VTV", "VUG", "QUAL", "MTUM", "USMV"]);
  });

  it("starts history after the youngest leg's inception", () => {
    // USMV and QUAL both launched in 2013; an earlier start silently omits them.
    expect(FACTOR_HISTORY_START >= "2013-09-01").toBe(true);
  });
});

describe("buildFactorRows", () => {
  const { rows, datesSkipped } = buildFactorRows(completePanel());

  it("emits one row per complete date", () => {
    expect(rows).toHaveLength(3);
    expect(datesSkipped).toEqual([]);
    expect(rows.map((r) => r.date)).toEqual(DATES);
  });

  it("computes market_rf as the market leg minus the risk-free leg", () => {
    expect(rows[0]?.market_rf).toBeCloseTo(0.01 - 0.0002, 12);
  });

  it("computes each style factor as long minus short", () => {
    expect(rows[0]?.smb).toBeCloseTo(0.015 - 0.01, 12); // IWM - SPY
    expect(rows[0]?.hml).toBeCloseTo(0.008 - 0.012, 12); // VTV - VUG
    expect(rows[0]?.quality).toBeCloseTo(0.011 - 0.01, 12); // QUAL - SPY
    expect(rows[0]?.momentum).toBeCloseTo(0.014 - 0.01, 12); // MTUM - SPY
    expect(rows[0]?.low_vol).toBeCloseTo(0.006 - 0.01, 12); // USMV - SPY
  });

  it("stores the risk-free rate itself, not a spread", () => {
    expect(rows[0]?.rf).toBeCloseTo(0.0002, 12);
  });

  it("preserves the sign of a negative spread", () => {
    // HML is negative here: value underperformed growth.
    expect(rows[0]?.hml).toBeLessThan(0);
  });

  it("skips a date where any single leg is missing", () => {
    // A partial row would compute market_rf on one calendar and hml on another.
    const panel = completePanel();
    panel.USMV = series([0.006, -0.001], DATES.slice(0, 2));
    const result = buildFactorRows(panel);
    expect(result.rows.map((r) => r.date)).toEqual(DATES.slice(0, 2));
    expect(result.datesSkipped).toEqual(["2024-01-04"]);
  });

  it("skips a date where the risk-free leg is missing", () => {
    const panel = completePanel();
    panel.BIL = series([0.0002, 0.0002], DATES.slice(0, 2));
    const result = buildFactorRows(panel);
    expect(result.datesSkipped).toEqual(["2024-01-04"]);
  });

  it("produces nothing when a leg is absent entirely", () => {
    const panel = completePanel();
    delete panel.MTUM;
    const result = buildFactorRows(panel);
    expect(result.rows).toEqual([]);
    expect(result.datesSkipped).toEqual(DATES);
  });

  it("ignores non-finite values by treating the date as incomplete", () => {
    const panel = completePanel();
    panel.SPY = series([0.01, Number.NaN, 0.002]);
    const result = buildFactorRows(panel);
    expect(result.datesSkipped).toEqual(["2024-01-03"]);
    expect(result.rows).toHaveLength(2);
  });

  it("emits rows sorted ascending by date regardless of input order", () => {
    const reversed = [...DATES].reverse();
    const panel = Object.fromEntries(
      Object.entries(completePanel()).map(([ticker, s]) => [
        ticker,
        series([...s.values].reverse(), reversed),
      ]),
    );
    expect(buildFactorRows(panel).rows.map((r) => r.date)).toEqual(DATES);
  });

  it("honours a custom definition set", () => {
    const onlyValue = FACTOR_DEFINITIONS.filter((d) => d.key === "hml");
    const result = buildFactorRows(completePanel(), onlyValue, RISK_FREE_PROXY);
    // Unlisted factors fall back to 0 (or null for the nullable columns).
    expect(result.rows[0]?.hml).toBeCloseTo(0.008 - 0.012, 12);
    expect(result.rows[0]?.market_rf).toBe(0);
    expect(result.rows[0]?.low_vol).toBeNull();
  });
});
