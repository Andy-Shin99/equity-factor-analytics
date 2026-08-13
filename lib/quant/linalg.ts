/**
 * Minimal dense linear algebra for OLS.
 *
 * Scope is deliberately tiny: the factor models here are at most ~7 regressors
 * over a few thousand observations, so clarity beats blocked/BLAS-style
 * optimisation. Every function is pure and total — a singular system throws
 * rather than returning quietly wrong numbers.
 */

export type Matrix = readonly (readonly number[])[];
export type Vector = readonly number[];

export class SingularMatrixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SingularMatrixError";
  }
}

function assertRectangular(a: Matrix, label: string): number {
  if (a.length === 0) throw new Error(`${label} has no rows`);
  const width = a[0]?.length ?? 0;
  if (width === 0) throw new Error(`${label} has no columns`);
  for (const row of a) {
    if (row.length !== width) throw new Error(`${label} is not rectangular`);
  }
  return width;
}

export function transpose(a: Matrix): number[][] {
  const width = assertRectangular(a, "matrix");
  return Array.from({ length: width }, (_, j) =>
    Array.from({ length: a.length }, (_, i) => a[i]?.[j] ?? 0),
  );
}

/** Matrix product. Throws on a dimension mismatch instead of producing NaN. */
export function matMul(a: Matrix, b: Matrix): number[][] {
  const aWidth = assertRectangular(a, "left matrix");
  const bWidth = assertRectangular(b, "right matrix");
  if (aWidth !== b.length) {
    throw new Error(`Dimension mismatch: ${a.length}x${aWidth} times ${b.length}x${bWidth}`);
  }

  const out: number[][] = Array.from({ length: a.length }, () => new Array<number>(bWidth).fill(0));
  for (let i = 0; i < a.length; i++) {
    const aRow = a[i];
    const outRow = out[i];
    if (!aRow || !outRow) continue;
    for (let k = 0; k < aWidth; k++) {
      const aik = aRow[k] ?? 0;
      if (aik === 0) continue;
      const bRow = b[k];
      if (!bRow) continue;
      for (let j = 0; j < bWidth; j++) {
        // `noUncheckedIndexedAccess` makes a bare `+=` on an index unsound.
        outRow[j] = (outRow[j] ?? 0) + aik * (bRow[j] ?? 0);
      }
    }
  }
  return out;
}

export function matVecMul(a: Matrix, x: Vector): number[] {
  const width = assertRectangular(a, "matrix");
  if (width !== x.length) {
    throw new Error(`Dimension mismatch: ${a.length}x${width} times vector of ${x.length}`);
  }
  return a.map((row) => {
    let sum = 0;
    for (let j = 0; j < width; j++) sum += (row[j] ?? 0) * (x[j] ?? 0);
    return sum;
  });
}

export function dot(a: Vector, b: Vector): number {
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: dot of ${a.length} and ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

export function identity(n: number): number[][] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
}

/**
 * Invert a square matrix by Gauss-Jordan elimination with partial pivoting.
 *
 * Used for (XᵀX)⁻¹, which OLS needs explicitly — the diagonal supplies each
 * coefficient's standard error, so a factorisation that only solves the system
 * would not be enough.
 *
 * Perfect multicollinearity between factors (a duplicated column, or a factor
 * that is an exact linear combination of others) surfaces here as a zero pivot.
 * That must throw: the betas would otherwise be arbitrary.
 */
export function invert(a: Matrix): number[][] {
  const n = a.length;
  const width = assertRectangular(a, "matrix");
  if (width !== n) throw new Error(`Cannot invert a non-square ${n}x${width} matrix`);

  // Work on augmented copies [A | I].
  const left = a.map((row) => [...row]);
  const right = identity(n);

  for (let col = 0; col < n; col++) {
    // Partial pivoting: the largest magnitude pivot available below the diagonal.
    let pivotRow = col;
    let pivotMagnitude = Math.abs(left[col]?.[col] ?? 0);
    for (let r = col + 1; r < n; r++) {
      const candidate = Math.abs(left[r]?.[col] ?? 0);
      if (candidate > pivotMagnitude) {
        pivotMagnitude = candidate;
        pivotRow = r;
      }
    }

    if (!Number.isFinite(pivotMagnitude) || pivotMagnitude < 1e-12) {
      throw new SingularMatrixError(
        `Matrix is singular or near-singular at column ${col} (pivot ${pivotMagnitude}). ` +
          "In a factor regression this usually means two factors are perfectly collinear.",
      );
    }

    if (pivotRow !== col) {
      [left[col], left[pivotRow]] = [left[pivotRow]!, left[col]!];
      [right[col], right[pivotRow]] = [right[pivotRow]!, right[col]!];
    }

    const leftPivot = left[col]!;
    const rightPivot = right[col]!;
    const pivot = leftPivot[col]!;

    for (let j = 0; j < n; j++) {
      leftPivot[j] = (leftPivot[j] ?? 0) / pivot;
      rightPivot[j] = (rightPivot[j] ?? 0) / pivot;
    }

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = left[r]?.[col] ?? 0;
      if (factor === 0) continue;
      const leftRow = left[r]!;
      const rightRow = right[r]!;
      for (let j = 0; j < n; j++) {
        leftRow[j] = (leftRow[j] ?? 0) - factor * (leftPivot[j] ?? 0);
        rightRow[j] = (rightRow[j] ?? 0) - factor * (rightPivot[j] ?? 0);
      }
    }
  }

  return right;
}
