import { FACTOR_KEYS, type FactorKey, type PortfolioHolding } from "@/types/domain";

/**
 * Request validation for the public API routes.
 *
 * Hand-rolled rather than schema-library-driven, for two reasons: it keeps the
 * dependency surface at zero, and the useful errors here are domain errors
 * ("weights sum to 0.87") rather than type errors, which a generic validator
 * phrases badly.
 *
 * Every limit below exists to bound work per invocation. These routes are public
 * and unauthenticated, so an unbounded ticker list or a 200-year window is a
 * denial-of-service vector against both the Vercel function budget and the
 * Supabase connection pool.
 */

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Bounds, all deliberately generous for real use but finite. */
export const LIMITS = {
  maxHoldings: 100,
  maxTickerLength: 15,
  /** ~20 years of daily data. */
  maxRangeDays: 7500,
  minRollingWindow: 20,
  /** ~2 years; beyond this a "rolling" beta is just the full-sample beta. */
  maxRollingWindow: 504,
  maxNameLength: 120,
  /** Tolerance on |sum(weights) - 1| before a portfolio is rejected. */
  weightSumTolerance: 0.01,
} as const;

/**
 * Yahoo symbols: letters, digits, dot (KRX suffixes like 005930.KS), hyphen
 * (BRK-B), and caret (indices like ^GSPC).
 */
const TICKER_PATTERN = /^[A-Z0-9.^-]{1,15}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireTicker(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`, field);
  }
  const ticker = value.trim().toUpperCase();
  if (!TICKER_PATTERN.test(ticker)) {
    throw new ValidationError(
      `${field} "${value}" is not a valid ticker (expected up to ${LIMITS.maxTickerLength} of A-Z, 0-9, ".", "-", "^")`,
      field,
    );
  }
  return ticker;
}

export function requireIsoDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    throw new ValidationError(`${field} must be an ISO date (YYYY-MM-DD)`, field);
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    throw new ValidationError(`${field} "${value}" is not a real calendar date`, field);
  }
  // Guard against 2024-02-31-style dates that parse but roll over.
  if (new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new ValidationError(`${field} "${value}" is not a real calendar date`, field);
  }
  return value;
}

export interface ValidatedRange {
  from: string;
  to: string;
}

export function requireRange(body: Record<string, unknown>): ValidatedRange {
  const from = requireIsoDate(body.from, "from");
  const to = requireIsoDate(body.to, "to");

  if (from > to) {
    throw new ValidationError(`from (${from}) must not be after to (${to})`, "from");
  }

  const spanDays =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (spanDays > LIMITS.maxRangeDays) {
    throw new ValidationError(
      `Range spans ${Math.round(spanDays)} days; the maximum is ${LIMITS.maxRangeDays}`,
      "from",
    );
  }

  return { from, to };
}

export interface ValidatedHoldings {
  holdings: PortfolioHolding[];
  weightSum: number;
}

/**
 * Accept holdings either as an array of `{ ticker, weight }` or as a
 * `{ TICKER: weight }` map — the latter is how `weights_json` is stored, so a
 * client can round-trip a saved portfolio without reshaping it.
 */
export function requireHoldings(
  value: unknown,
  field = "holdings",
  options: { enforceSumToOne?: boolean } = {},
): ValidatedHoldings {
  const entries: Array<[unknown, unknown]> = Array.isArray(value)
    ? value.map((item) => {
        if (!isRecord(item)) {
          throw new ValidationError(`${field} entries must be objects`, field);
        }
        return [item.ticker, item.weight];
      })
    : isRecord(value)
      ? Object.entries(value)
      : (() => {
          throw new ValidationError(
            `${field} must be an array of { ticker, weight } or an object map`,
            field,
          );
        })();

  if (entries.length === 0) {
    throw new ValidationError(`${field} must contain at least one holding`, field);
  }
  if (entries.length > LIMITS.maxHoldings) {
    throw new ValidationError(
      `${field} has ${entries.length} entries; the maximum is ${LIMITS.maxHoldings}`,
      field,
    );
  }

  const seen = new Set<string>();
  const holdings: PortfolioHolding[] = [];
  let weightSum = 0;

  for (const [rawTicker, rawWeight] of entries) {
    const ticker = requireTicker(rawTicker, `${field}.ticker`);
    if (seen.has(ticker)) {
      throw new ValidationError(`${field} contains ${ticker} more than once`, field);
    }
    seen.add(ticker);

    const weight = typeof rawWeight === "number" ? rawWeight : Number(rawWeight);
    if (!Number.isFinite(weight)) {
      throw new ValidationError(`Weight for ${ticker} must be a finite number`, field);
    }
    if (weight < 0) {
      // Short positions would need borrow modelling and a different return
      // aggregation; out of scope rather than silently mishandled.
      throw new ValidationError(
        `Weight for ${ticker} is negative; short positions are not supported`,
        field,
      );
    }

    holdings.push({ ticker, weight });
    weightSum += weight;
  }

  if (!(weightSum > 0)) {
    throw new ValidationError(`${field} weights sum to ${weightSum}; expected a positive total`, field);
  }

  if (
    options.enforceSumToOne &&
    Math.abs(weightSum - 1) > LIMITS.weightSumTolerance
  ) {
    throw new ValidationError(
      `Weights sum to ${weightSum.toFixed(6)}, expected 1.0 (+/-${LIMITS.weightSumTolerance}). ` +
        "Pass normalize: true to rescale automatically.",
      field,
    );
  }

  return { holdings, weightSum };
}

export function normalizeHoldings(holdings: PortfolioHolding[], weightSum: number): PortfolioHolding[] {
  return holdings.map((h) => ({ ticker: h.ticker, weight: h.weight / weightSum }));
}

export function optionalFactors(value: unknown): readonly FactorKey[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError("factors must be a non-empty array of factor keys", "factors");
  }

  const allowed = new Set<string>(FACTOR_KEYS);
  const seen = new Set<FactorKey>();
  for (const key of value) {
    if (typeof key !== "string" || !allowed.has(key)) {
      throw new ValidationError(
        `Unknown factor "${String(key)}"; expected one of ${FACTOR_KEYS.join(", ")}`,
        "factors",
      );
    }
    seen.add(key as FactorKey);
  }
  // Preserve the canonical order so design-matrix columns stay predictable.
  return FACTOR_KEYS.filter((key) => seen.has(key));
}

export function optionalRollingWindow(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const window = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(window)) {
    throw new ValidationError("rollingWindow must be an integer", "rollingWindow");
  }
  if (window < LIMITS.minRollingWindow || window > LIMITS.maxRollingWindow) {
    throw new ValidationError(
      `rollingWindow must be between ${LIMITS.minRollingWindow} and ${LIMITS.maxRollingWindow}`,
      "rollingWindow",
    );
  }
  return window;
}

export function optionalPositiveInt(value: unknown, field: string, max: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new ValidationError(`${field} must be an integer between 1 and ${max}`, field);
  }
  return parsed;
}

export function requireName(value: unknown, field = "name"): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`, field);
  }
  const name = value.trim();
  if (name.length === 0) {
    throw new ValidationError(`${field} must not be empty`, field);
  }
  if (name.length > LIMITS.maxNameLength) {
    throw new ValidationError(
      `${field} is ${name.length} characters; the maximum is ${LIMITS.maxNameLength}`,
      field,
    );
  }
  return name;
}

/** Parse a JSON body, converting malformed input into a ValidationError. */
export async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
  if (!isRecord(body)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  return body;
}
