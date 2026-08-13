import { describe, expect, it } from "vitest";

import {
  logGamma,
  regularizedIncompleteBeta,
  studentTCdf,
  twoSidedTPValue,
} from "./distributions";

describe("logGamma", () => {
  it("matches factorials", () => {
    // Γ(n) = (n-1)!
    expect(Math.exp(logGamma(1))).toBeCloseTo(1, 10);
    expect(Math.exp(logGamma(5))).toBeCloseTo(24, 8);
    expect(Math.exp(logGamma(11))).toBeCloseTo(3_628_800, 3);
  });

  it("matches Γ(1/2) = sqrt(pi)", () => {
    expect(Math.exp(logGamma(0.5))).toBeCloseTo(Math.sqrt(Math.PI), 10);
  });

  it("rejects non-positive arguments", () => {
    expect(() => logGamma(0)).toThrow();
    expect(() => logGamma(-1)).toThrow();
  });
});

describe("regularizedIncompleteBeta", () => {
  it("is 0 at x=0 and 1 at x=1", () => {
    expect(regularizedIncompleteBeta(2, 3, 0)).toBe(0);
    expect(regularizedIncompleteBeta(2, 3, 1)).toBe(1);
  });

  it("matches the closed form I_x(1/2, 1/2) = (2/pi) arcsin(sqrt(x))", () => {
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const expected = (2 / Math.PI) * Math.asin(Math.sqrt(x));
      expect(regularizedIncompleteBeta(0.5, 0.5, x)).toBeCloseTo(expected, 10);
    }
  });

  it("matches the closed form I_x(1, b) = 1 - (1-x)^b", () => {
    expect(regularizedIncompleteBeta(1, 3, 0.4)).toBeCloseTo(1 - 0.6 ** 3, 10);
  });

  it("satisfies the symmetry I_x(a,b) = 1 - I_{1-x}(b,a)", () => {
    const left = regularizedIncompleteBeta(2.5, 7.5, 0.3);
    const right = 1 - regularizedIncompleteBeta(7.5, 2.5, 0.7);
    expect(left).toBeCloseTo(right, 12);
  });

  it("rejects out-of-domain input", () => {
    expect(() => regularizedIncompleteBeta(2, 3, 1.5)).toThrow();
    expect(() => regularizedIncompleteBeta(0, 3, 0.5)).toThrow();
  });
});

describe("twoSidedTPValue", () => {
  it("is 1 at t=0", () => {
    expect(twoSidedTPValue(0, 30)).toBe(1);
  });

  it("is symmetric in t", () => {
    expect(twoSidedTPValue(2.3, 25)).toBeCloseTo(twoSidedTPValue(-2.3, 25), 14);
  });

  it("reproduces the Cauchy case exactly (df=1)", () => {
    // P(|T| > 1) = 0.5 for a standard Cauchy.
    expect(twoSidedTPValue(1, 1)).toBeCloseTo(0.5, 12);
  });

  it("matches published critical values", () => {
    // Standard two-tailed 5% critical values from t tables.
    expect(twoSidedTPValue(2.228, 10)).toBeCloseTo(0.05, 4);
    expect(twoSidedTPValue(2.086, 20)).toBeCloseTo(0.05, 4);
    expect(twoSidedTPValue(1.984, 100)).toBeCloseTo(0.05, 4);
    // 1% two-tailed, df=10.
    expect(twoSidedTPValue(3.169, 10)).toBeCloseTo(0.01, 4);
  });

  it("approaches the normal limit for large df", () => {
    // 1.959964 is the two-tailed 5% z critical value.
    expect(twoSidedTPValue(1.959964, 1_000_000)).toBeCloseTo(0.05, 5);
  });

  it("stays accurate deep in the tail where a density integral would lose precision", () => {
    const p = twoSidedTPValue(12, 54);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan
      (1e-15);
  });

  it("rejects invalid degrees of freedom", () => {
    expect(() => twoSidedTPValue(1, 0)).toThrow();
    expect(() => twoSidedTPValue(1, -5)).toThrow();
  });
});

describe("studentTCdf", () => {
  it("is 0.5 at t=0", () => {
    expect(studentTCdf(0, 10)).toBeCloseTo(0.5, 12);
  });

  it("matches the Cauchy CDF at t=1 (df=1)", () => {
    expect(studentTCdf(1, 1)).toBeCloseTo(0.75, 12);
    expect(studentTCdf(-1, 1)).toBeCloseTo(0.25, 12);
  });

  it("is complementary about zero", () => {
    expect(studentTCdf(1.7, 15) + studentTCdf(-1.7, 15)).toBeCloseTo(1, 12);
  });
});
