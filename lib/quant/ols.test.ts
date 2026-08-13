import { describe, expect, it } from "vitest";

import { SingularMatrixError } from "./linalg";
import { ols } from "./ols";

/**
 * Textbook simple-regression case, worked by hand:
 *   x = [1,2,3,4,5], y = [2,4,5,4,5]
 *   Sxx = 10, Sxy = 6  ->  beta = 0.6, alpha = 2.2
 *   RSS = 2.4, TSS = 6 ->  R^2 = 0.6, adjR^2 = 7/15
 *   sigma^2 = 0.8      ->  SE(beta) = sqrt(0.08), SE(alpha) = sigma*sqrt(1.1)
 */
const Y = [2, 4, 5, 4, 5];
const X = [[1], [2], [3], [4], [5]];

describe("ols — known-answer simple regression", () => {
  const fit = ols(Y, X, { regressorNames: ["x"] });

  it("recovers the slope and intercept", () => {
    expect(fit.intercept.estimate).toBeCloseTo(2.2, 12);
    expect(fit.terms[0]?.estimate).toBeCloseTo(0.6, 12);
  });

  it("reports the right dimensions", () => {
    expect(fit.n).toBe(5);
    expect(fit.k).toBe(1);
    expect(fit.df).toBe(3);
  });

  it("recovers R-squared and adjusted R-squared", () => {
    expect(fit.rSquared).toBeCloseTo(0.6, 12);
    expect(fit.adjustedRSquared).toBeCloseTo(7 / 15, 12);
  });

  it("recovers the residual standard error", () => {
    expect(fit.residualStandardError).toBeCloseTo(Math.sqrt(0.8), 12);
  });

  it("recovers standard errors and t-statistics", () => {
    expect(fit.terms[0]?.standardError).toBeCloseTo(Math.sqrt(0.08), 12);
    expect(fit.terms[0]?.tStat).toBeCloseTo(0.6 / Math.sqrt(0.08), 10);

    const alphaSe = Math.sqrt(0.8) * Math.sqrt(1.1);
    expect(fit.intercept.standardError).toBeCloseTo(alphaSe, 12);
    expect(fit.intercept.tStat).toBeCloseTo(2.2 / alphaSe, 10);
  });

  it("produces p-values consistent with the t-statistics", () => {
    // t = 2.1213 on 3 df is not significant at 5%.
    expect(fit.terms[0]?.pValue).toBeGreaterThan(0.05);
    expect(fit.terms[0]?.pValue).toBeLessThan(0.2);
  });

  it("names terms from the supplied labels", () => {
    expect(fit.intercept.name).toBe("alpha");
    expect(fit.terms[0]?.name).toBe("x");
  });

  it("defaults regressor names when none are given", () => {
    expect(ols(Y, X).terms[0]?.name).toBe("x1");
  });
});

describe("ols — algebraic invariants", () => {
  // These hold for any OLS fit with an intercept, so they catch sign errors and
  // transposition bugs in the multi-regressor path without external references.
  const y = [1.2, -0.4, 0.9, 2.1, -1.3, 0.5, 1.8, -0.2];
  const X = [
    [0.5, 1.2],
    [-0.3, 0.4],
    [0.8, -0.5],
    [1.5, 0.9],
    [-1.1, 0.2],
    [0.2, -1.4],
    [1.0, 0.7],
    [-0.6, -0.9],
  ];
  const fit = ols(y, X, { regressorNames: ["mkt", "smb"] });

  it("residuals sum to zero", () => {
    expect(fit.residuals.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12);
  });

  it("residuals are orthogonal to every regressor", () => {
    for (let j = 0; j < 2; j++) {
      const inner = fit.residuals.reduce((sum, e, i) => sum + e * (X[i]?.[j] ?? 0), 0);
      expect(inner).toBeCloseTo(0, 12);
    }
  });

  it("fitted plus residual reconstructs y", () => {
    fit.fitted.forEach((f, i) => expect(f + (fit.residuals[i] ?? 0)).toBeCloseTo(y[i] ?? 0, 12));
  });

  it("R-squared lies in [0, 1]", () => {
    expect(fit.rSquared).toBeGreaterThanOrEqual(0);
    expect(fit.rSquared).toBeLessThanOrEqual(1);
  });
});

describe("ols — perfect fit", () => {
  it("returns R-squared of 1 and NaN inference when residuals vanish", () => {
    // y = 2 + 3x exactly. A zero standard error makes the t-statistic
    // undefined; reporting p = 0 would claim infinite confidence.
    const fit = ols([5, 8, 11, 14], [[1], [2], [3], [4]]);
    expect(fit.terms[0]?.estimate).toBeCloseTo(3, 10);
    expect(fit.intercept.estimate).toBeCloseTo(2, 10);
    expect(fit.rSquared).toBeCloseTo(1, 12);
    expect(fit.degenerate).toBe(true);
    expect(fit.terms[0]?.tStat).toBeNaN();
    expect(fit.terms[0]?.pValue).toBeNaN();
    expect(fit.intercept.pValue).toBeNaN();
  });

  it("does not flag an ordinary good fit as degenerate", () => {
    // R^2 = 0.6 here; the degeneracy guard must not fire on real regressions.
    const fit = ols(Y, X);
    expect(fit.degenerate).toBe(false);
    expect(Number.isFinite(fit.terms[0]?.tStat ?? Number.NaN)).toBe(true);
  });
});

describe("ols — guards", () => {
  it("rejects a design matrix whose row count does not match y", () => {
    expect(() => ols([1, 2, 3], [[1], [2]])).toThrow(/rows but y has/);
  });

  it("refuses to fit without residual degrees of freedom", () => {
    // 3 observations, 2 regressors -> df = 0.
    expect(() =>
      ols(
        [1, 2, 3],
        [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
      ),
    ).toThrow(/degrees of freedom/);
  });

  it("throws on perfectly collinear factors instead of returning arbitrary betas", () => {
    const y = [1, 2, 3, 4, 5, 6];
    const collinear = y.map((v) => [v, 2 * v]); // second column = 2x the first
    expect(() => ols(y, collinear)).toThrow(SingularMatrixError);
  });

  it("rejects non-finite input", () => {
    expect(() => ols([1, Number.NaN, 3, 4], [[1], [2], [3], [4]])).toThrow(/non-finite/);
    expect(() => ols([1, 2, 3, 4], [[1], [Number.POSITIVE_INFINITY], [3], [4]])).toThrow(
      /non-finite/,
    );
  });

  it("returns R-squared of 0 for a constant y rather than NaN", () => {
    const fit = ols([3, 3, 3, 3], [[1], [2], [3], [5]]);
    expect(fit.rSquared).toBe(0);
  });
});
