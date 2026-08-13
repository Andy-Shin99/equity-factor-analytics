import { describe, expect, it } from "vitest";

import { alignToDates, rowToObservation, toDesignMatrix } from "./factorData";
import type { FactorReturnRow } from "@/types/database";
import { FACTOR_KEYS, type FactorKey } from "@/types/domain";

const completeRow: FactorReturnRow = {
  date: "2024-01-02",
  market_rf: 0.0102,
  smb: -0.0031,
  hml: 0.0044,
  quality: 0.0012,
  momentum: 0.0078,
  low_vol: -0.0005,
  rf: 0.0002,
};

describe("rowToObservation", () => {
  it("maps every factor column", () => {
    const observation = rowToObservation(completeRow, FACTOR_KEYS);
    expect(observation?.date).toBe("2024-01-02");
    expect(observation?.values.low_vol).toBe(-0.0005);
    expect(Object.keys(observation?.values ?? {}).sort()).toEqual([...FACTOR_KEYS].sort());
  });

  it("drops the observation when a requested factor is null", () => {
    // Imputing 0 here would bias the low-vol beta toward zero while leaving
    // R-squared looking healthy — a silent failure.
    const row = { ...completeRow, low_vol: null };
    expect(rowToObservation(row, FACTOR_KEYS)).toBeNull();
  });

  it("keeps the observation when the null factor was not requested", () => {
    const row = { ...completeRow, low_vol: null };
    const subset: FactorKey[] = ["market_rf", "smb", "hml"];
    expect(rowToObservation(row, subset)?.values).toEqual({
      market_rf: 0.0102,
      smb: -0.0031,
      hml: 0.0044,
    });
  });

  it("drops non-finite values", () => {
    const row = { ...completeRow, momentum: Number.NaN };
    expect(rowToObservation(row, FACTOR_KEYS)).toBeNull();
  });
});

describe("toDesignMatrix", () => {
  it("emits columns in the requested factor order", () => {
    const factors: FactorKey[] = ["market_rf", "hml"];
    const observations = [
      { date: "2024-01-02", values: { market_rf: 0.01, hml: 0.02 } as Record<FactorKey, number> },
      { date: "2024-01-03", values: { market_rf: 0.03, hml: 0.04 } as Record<FactorKey, number> },
    ];

    expect(toDesignMatrix(observations, factors)).toEqual({
      dates: ["2024-01-02", "2024-01-03"],
      rows: [
        [0.01, 0.02],
        [0.03, 0.04],
      ],
      factors,
    });
  });

  it("returns empty structures for no observations", () => {
    expect(toDesignMatrix([], FACTOR_KEYS).rows).toEqual([]);
  });
});

describe("alignToDates", () => {
  const observations = ["2024-01-02", "2024-01-03", "2024-01-04"].map((date) => ({
    date,
    values: {} as Record<FactorKey, number>,
  }));

  it("keeps only dates the return series also has", () => {
    // A one-day misalignment shifts every residual in the regression.
    const aligned = alignToDates(observations, ["2024-01-03", "2024-01-04", "2024-01-05"]);
    expect(aligned.map((o) => o.date)).toEqual(["2024-01-03", "2024-01-04"]);
  });

  it("returns nothing when there is no overlap", () => {
    expect(alignToDates(observations, ["2023-01-01"])).toEqual([]);
  });
});
