/**
 * The distribution functions OLS inference needs.
 *
 * A t-statistic on its own is not decision-grade output: a PM needs to know
 * whether an alpha is distinguishable from zero, which requires a real Student's
 * t CDF, not a normal approximation. With 60-day rolling windows the degrees of
 * freedom get small enough (~54) that the normal approximation understates
 * p-values noticeably, so the exact distribution is implemented here.
 */

/** Lanczos approximation of log Γ(x), accurate to ~15 significant digits for x > 0. */
export function logGamma(x: number): number {
  if (x <= 0 || !Number.isFinite(x)) {
    throw new Error(`logGamma requires a positive finite argument, got ${x}`);
  }

  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];

  // Reflection for small arguments keeps the series in its accurate range.
  if (x < 0.5) {
    return (
      Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
    );
  }

  const z = x - 1;
  let series = 0.99999999999980993;
  for (let i = 0; i < coefficients.length; i++) {
    series += (coefficients[i] ?? 0) / (z + i + 1);
  }

  const t = z + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(series);
}

const MAX_ITERATIONS = 300;
const EPSILON = 3e-16;
/** Guards against division by zero in the modified Lentz algorithm. */
const TINY = 1e-300;

/**
 * Continued fraction for the incomplete beta function (Lentz's modified
 * algorithm). Only converges quickly for x < (a+1)/(a+b+2); the caller applies
 * the symmetry transform outside that region.
 */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;

  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let result = d;

  for (let m = 1; m <= MAX_ITERATIONS; m++) {
    const m2 = 2 * m;

    // Even step.
    let numerator = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + numerator / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    result *= d * c;

    // Odd step.
    numerator = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + numerator / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    result *= delta;

    if (Math.abs(delta - 1) < EPSILON) return result;
  }

  throw new Error(
    `Incomplete beta continued fraction failed to converge for a=${a}, b=${b}, x=${x}`,
  );
}

/**
 * Regularized incomplete beta function I_x(a, b).
 * This is the workhorse behind the Student's t CDF.
 */
export function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (a <= 0 || b <= 0) throw new Error(`Beta parameters must be positive: a=${a}, b=${b}`);
  if (x < 0 || x > 1) throw new Error(`Beta argument must lie in [0, 1], got ${x}`);
  if (x === 0) return 0;
  if (x === 1) return 1;

  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );

  // The continued fraction only converges well on one side of this threshold;
  // reflect onto the good side when needed.
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/**
 * Two-sided p-value for a t-statistic, i.e. P(|T| >= |t|) with `df` degrees of
 * freedom.
 *
 * Uses the identity P(|T| >= t) = I_{df/(df+t²)}(df/2, 1/2), which is exact and
 * numerically well behaved across the whole range — including the large-|t|
 * tail, where naively integrating the density loses all precision.
 */
export function twoSidedTPValue(t: number, df: number): number {
  if (!Number.isFinite(t)) throw new Error(`t-statistic must be finite, got ${t}`);
  if (!Number.isFinite(df) || df <= 0) {
    throw new Error(`Degrees of freedom must be a positive finite number, got ${df}`);
  }
  if (t === 0) return 1;

  const x = df / (df + t * t);
  return regularizedIncompleteBeta(df / 2, 0.5, x);
}

/** CDF of the Student's t distribution, P(T <= t). */
export function studentTCdf(t: number, df: number): number {
  const half = twoSidedTPValue(t, df) / 2;
  return t > 0 ? 1 - half : half;
}
