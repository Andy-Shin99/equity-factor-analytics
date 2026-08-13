import { describe, expect, it } from "vitest";

import {
  LIMITS,
  normalizeHoldings,
  optionalFactors,
  optionalPositiveInt,
  optionalRollingWindow,
  requireHoldings,
  requireIsoDate,
  requireName,
  requireRange,
  requireTicker,
  ValidationError,
} from "./validation";

describe("requireTicker", () => {
  it("upper-cases and trims", () => {
    expect(requireTicker(" aapl ", "t")).toBe("AAPL");
  });

  it("accepts KRX suffixes, hyphens and index carets", () => {
    expect(requireTicker("005930.KS", "t")).toBe("005930.KS");
    expect(requireTicker("brk-b", "t")).toBe("BRK-B");
    expect(requireTicker("^GSPC", "t")).toBe("^GSPC");
  });

  it("rejects injection-shaped and overlong input", () => {
    expect(() => requireTicker("AAPL;DROP", "t")).toThrow(ValidationError);
    expect(() => requireTicker("A".repeat(16), "t")).toThrow(/not a valid ticker/);
    expect(() => requireTicker("", "t")).toThrow(ValidationError);
    expect(() => requireTicker(42, "t")).toThrow(/must be a string/);
  });
});

describe("requireIsoDate", () => {
  it("accepts a real ISO date", () => {
    expect(requireIsoDate("2024-02-29", "d")).toBe("2024-02-29");
  });

  it("rejects a date that parses but rolls over", () => {
    // 2023 is not a leap year; Date.parse would happily roll this to March.
    expect(() => requireIsoDate("2023-02-29", "d")).toThrow(/not a real calendar date/);
    expect(() => requireIsoDate("2024-13-01", "d")).toThrow();
  });

  it("rejects other formats", () => {
    expect(() => requireIsoDate("2024/01/02", "d")).toThrow(/ISO date/);
    expect(() => requireIsoDate("20240102", "d")).toThrow(/ISO date/);
  });
});

describe("requireRange", () => {
  it("accepts an ordered range", () => {
    expect(requireRange({ from: "2024-01-01", to: "2024-12-31" })).toEqual({
      from: "2024-01-01",
      to: "2024-12-31",
    });
  });

  it("rejects an inverted range", () => {
    expect(() => requireRange({ from: "2024-12-31", to: "2024-01-01" })).toThrow(
      /must not be after/,
    );
  });

  it("bounds the span so one request cannot pull unbounded history", () => {
    expect(() => requireRange({ from: "1900-01-01", to: "2024-01-01" })).toThrow(
      new RegExp(`maximum is ${LIMITS.maxRangeDays}`),
    );
  });
});

describe("requireHoldings", () => {
  it("accepts an array of holdings", () => {
    const { holdings, weightSum } = requireHoldings([
      { ticker: "aapl", weight: 0.6 },
      { ticker: "msft", weight: 0.4 },
    ]);
    expect(holdings).toEqual([
      { ticker: "AAPL", weight: 0.6 },
      { ticker: "MSFT", weight: 0.4 },
    ]);
    expect(weightSum).toBeCloseTo(1, 12);
  });

  it("accepts the stored weights_json map shape", () => {
    // Lets a client round-trip a saved portfolio without reshaping it.
    const { holdings } = requireHoldings({ AAPL: 0.5, "005930.KS": 0.5 });
    expect(holdings.map((h) => h.ticker).sort()).toEqual(["005930.KS", "AAPL"]);
  });

  it("rejects duplicates", () => {
    expect(() =>
      requireHoldings([
        { ticker: "AAPL", weight: 0.5 },
        { ticker: "aapl", weight: 0.5 },
      ]),
    ).toThrow(/more than once/);
  });

  it("rejects short positions rather than mishandling them", () => {
    expect(() => requireHoldings([{ ticker: "AAPL", weight: -0.5 }])).toThrow(
      /short positions are not supported/,
    );
  });

  it("rejects non-finite weights", () => {
    expect(() => requireHoldings([{ ticker: "AAPL", weight: Number.NaN }])).toThrow(
      /finite number/,
    );
  });

  it("bounds the holding count", () => {
    const many = Array.from({ length: LIMITS.maxHoldings + 1 }, (_, i) => ({
      ticker: `T${i}`,
      weight: 1,
    }));
    expect(() => requireHoldings(many)).toThrow(/maximum is 100/);
  });

  it("rejects an empty or malformed set", () => {
    expect(() => requireHoldings([])).toThrow(/at least one holding/);
    expect(() => requireHoldings("AAPL")).toThrow(/must be an array/);
    expect(() => requireHoldings([{ ticker: "AAPL", weight: 0 }])).toThrow(/positive total/);
  });

  it("enforces the sum-to-one rule only when asked", () => {
    const partial = [{ ticker: "AAPL", weight: 0.87 }];
    expect(() => requireHoldings(partial, "holdings", { enforceSumToOne: true })).toThrow(
      /Weights sum to 0.870000/,
    );
    expect(requireHoldings(partial).weightSum).toBeCloseTo(0.87, 12);
  });
});

describe("normalizeHoldings", () => {
  it("rescales to sum to one", () => {
    const normalized = normalizeHoldings(
      [
        { ticker: "AAPL", weight: 1 },
        { ticker: "MSFT", weight: 3 },
      ],
      4,
    );
    expect(normalized).toEqual([
      { ticker: "AAPL", weight: 0.25 },
      { ticker: "MSFT", weight: 0.75 },
    ]);
  });
});

describe("optionalFactors", () => {
  it("returns undefined when absent", () => {
    expect(optionalFactors(undefined)).toBeUndefined();
  });

  it("restores canonical order so design-matrix columns stay predictable", () => {
    expect(optionalFactors(["hml", "market_rf"])).toEqual(["market_rf", "hml"]);
  });

  it("deduplicates", () => {
    expect(optionalFactors(["hml", "hml"])).toEqual(["hml"]);
  });

  it("rejects unknown keys and empty arrays", () => {
    expect(() => optionalFactors(["not_a_factor"])).toThrow(/Unknown factor/);
    expect(() => optionalFactors([])).toThrow(/non-empty/);
  });
});

describe("optionalRollingWindow", () => {
  it("accepts a value inside the bounds", () => {
    expect(optionalRollingWindow(60)).toBe(60);
  });

  it("rejects out-of-range or non-integer windows", () => {
    expect(() => optionalRollingWindow(5)).toThrow(/between 20 and 504/);
    expect(() => optionalRollingWindow(1000)).toThrow(/between 20 and 504/);
    expect(() => optionalRollingWindow(60.5)).toThrow(/must be an integer/);
  });
});

describe("optionalPositiveInt", () => {
  it("parses numeric strings from query parameters", () => {
    expect(optionalPositiveInt("50", "limit", 1000)).toBe(50);
  });

  it("rejects zero, negatives and overflow", () => {
    expect(() => optionalPositiveInt(0, "limit", 10)).toThrow(/between 1 and 10/);
    expect(() => optionalPositiveInt(-1, "limit", 10)).toThrow();
    expect(() => optionalPositiveInt(11, "limit", 10)).toThrow();
  });
});

describe("requireName", () => {
  it("trims", () => {
    expect(requireName("  Demo  ")).toBe("Demo");
  });

  it("rejects blank and overlong names", () => {
    expect(() => requireName("   ")).toThrow(/must not be empty/);
    expect(() => requireName("x".repeat(LIMITS.maxNameLength + 1))).toThrow(/maximum is 120/);
  });
});
