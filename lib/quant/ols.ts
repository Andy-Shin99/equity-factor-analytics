import { twoSidedTPValue } from "./distributions";
import { dot, invert, matMul, matVecMul, transpose, type Matrix, type Vector } from "./linalg";

/**
 * Ordinary least squares with full inference output.
 *
 * An intercept is always fitted and reported separately: in a factor model the
 * intercept *is* alpha, and it needs its own standard error and p-value. Callers
 * must therefore pass X without a column of ones.
 *
 * Solved via the normal equations, because (XᵀX)⁻¹ is needed explicitly for the
 * coefficient standard errors, not just to solve for the betas. At k <= 7
 * regressors the conditioning penalty is immaterial; perfect collinearity is
 * caught by `invert` and throws rather than returning arbitrary betas.
 */

export interface OlsTerm {
  name: string;
  estimate: number;
  standardError: number;
  tStat: number;
  /** Two-sided p-value against H0: coefficient = 0. */
  pValue: number;
}

export interface OlsFit {
  /** Number of observations. */
  n: number;
  /** Number of regressors, excluding the intercept. */
  k: number;
  /** Residual degrees of freedom, n - k - 1. */
  df: number;
  /** The fitted intercept — alpha, in a factor model. */
  intercept: OlsTerm;
  /** One entry per column of X, in column order. */
  terms: OlsTerm[];
  rSquared: number;
  adjustedRSquared: number;
  /** Residual standard error (sigma-hat), in the units of y. */
  residualStandardError: number;
  residuals: number[];
  fitted: number[];
  /**
   * True when the fit explains essentially all variance (or y has none at all).
   *
   * A degenerate fit is a modelling error, not a great result — typically the
   * "portfolio" and the benchmark are the same series. Inference is reported as
   * NaN in that case: floating-point residuals leave a standard error of ~1e-16
   * rather than exactly zero, which would otherwise yield a t-statistic around
   * 1e14 and p = 0, displayed to a PM as infinitely significant alpha.
   */
  degenerate: boolean;
}

export interface OlsOptions {
  /** Labels for the columns of X. Defaults to `x1`, `x2`, ... */
  regressorNames?: readonly string[];
  /** Label for the intercept term. */
  interceptName?: string;
}

export function ols(y: Vector, X: Matrix, options: OlsOptions = {}): OlsFit {
  const n = y.length;

  if (n === 0) throw new Error("OLS requires at least one observation");
  if (X.length !== n) {
    throw new Error(`Design matrix has ${X.length} rows but y has ${n} observations`);
  }

  const k = X[0]?.length ?? 0;
  if (k === 0) throw new Error("OLS requires at least one regressor");

  const df = n - k - 1;
  if (df < 1) {
    throw new Error(
      `Not enough observations: ${n} observations with ${k} regressors leaves ${df} residual ` +
        "degrees of freedom. Widen the window or drop factors.",
    );
  }

  for (const value of y) {
    if (!Number.isFinite(value)) throw new Error("y contains a non-finite value");
  }

  // Prepend the intercept column.
  const design: number[][] = X.map((row, i) => {
    if (row.length !== k) {
      throw new Error(`Design matrix row ${i} has ${row.length} columns, expected ${k}`);
    }
    for (const value of row) {
      if (!Number.isFinite(value)) {
        throw new Error(`Design matrix row ${i} contains a non-finite value`);
      }
    }
    return [1, ...row];
  });

  const designT = transpose(design);
  const xtxInverse = invert(matMul(designT, design));
  const xty = matVecMul(designT, y);
  const coefficients = matVecMul(xtxInverse, xty);

  const fitted = matVecMul(design, coefficients);
  const residuals = y.map((value, i) => value - (fitted[i] ?? 0));

  const residualSumOfSquares = dot(residuals, residuals);
  // `mean` lives in risk.ts; importing it here would only add a cycle for one line.
  const yMean = y.reduce((sum, value) => sum + value, 0) / n;
  const totalSumOfSquares = y.reduce((sum, value) => sum + (value - yMean) ** 2, 0);

  const residualVariance = residualSumOfSquares / df;
  const residualStandardError = Math.sqrt(residualVariance);

  // An exact fit leaves RSS/TSS at float noise (~1e-32), never exactly zero.
  // 1e-20 sits far below any genuine regression and far above that noise floor.
  const DEGENERACY_RATIO = 1e-20;
  const degenerate =
    totalSumOfSquares <= 0 || residualSumOfSquares <= totalSumOfSquares * DEGENERACY_RATIO;

  const toTerm = (name: string, index: number): OlsTerm => {
    const estimate = coefficients[index] ?? Number.NaN;
    const variance = residualVariance * (xtxInverse[index]?.[index] ?? Number.NaN);
    const standardError = Math.sqrt(Math.max(variance, 0));
    if (degenerate || !(standardError > 0)) {
      return { name, estimate, standardError, tStat: Number.NaN, pValue: Number.NaN };
    }
    const tStat = estimate / standardError;
    const pValue = Number.isFinite(tStat) ? twoSidedTPValue(tStat, df) : Number.NaN;
    return { name, estimate, standardError, tStat, pValue };
  };

  const regressorNames = options.regressorNames ?? [];
  const terms = Array.from({ length: k }, (_, j) =>
    toTerm(regressorNames[j] ?? `x${j + 1}`, j + 1),
  );

  // A constant y has nothing to explain; 0/0 would otherwise surface as NaN and
  // propagate into every downstream display.
  const rSquared =
    totalSumOfSquares > 0 ? 1 - residualSumOfSquares / totalSumOfSquares : 0;
  const adjustedRSquared = 1 - ((1 - rSquared) * (n - 1)) / df;

  return {
    n,
    k,
    df,
    intercept: toTerm(options.interceptName ?? "alpha", 0),
    terms,
    rSquared,
    adjustedRSquared,
    residualStandardError,
    residuals,
    fitted,
    degenerate,
  };
}
