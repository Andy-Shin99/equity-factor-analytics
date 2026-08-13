/**
 * Display formatters.
 *
 * Financial figures are read comparatively, so sign is always explicit on
 * anything that can be negative — a "2.10%" that might be a loss is worse than
 * no number. NaN and Infinity render as an em dash rather than leaking through
 * (a degenerate regression legitimately produces NaN inference).
 */

const EMPTY = "—";

function isBad(value: number | null | undefined): value is null | undefined {
  return value === null || value === undefined || !Number.isFinite(value);
}

export function formatPercent(
  value: number | null | undefined,
  { digits = 2, signed = false }: { digits?: number; signed?: boolean } = {},
): string {
  if (isBad(value)) return EMPTY;
  const text = `${(value * 100).toFixed(digits)}%`;
  return signed && value > 0 ? `+${text}` : text;
}

export function formatNumber(
  value: number | null | undefined,
  { digits = 2, signed = false }: { digits?: number; signed?: boolean } = {},
): string {
  if (isBad(value)) return EMPTY;
  const text = value.toFixed(digits);
  return signed && value > 0 ? `+${text}` : text;
}

/** p-values collapse fast; below 0.0001 an exponent is more honest than 0.0000. */
export function formatPValue(value: number | null | undefined): string {
  if (isBad(value)) return EMPTY;
  if (value < 0.0001) return value.toExponential(1);
  return value.toFixed(4);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  return iso;
}

/** Compact axis tick for a share, e.g. 0.125 -> "12.5%". */
export function percentTick(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function betaTick(value: number): string {
  return value.toFixed(2);
}

/**
 * Direction of a metric for coloring.
 * `higherIsBetter` is explicit because it is not inferable: a higher tracking
 * error is not good news, a higher information ratio is.
 */
export function deltaTone(
  value: number | null | undefined,
  higherIsBetter = true,
): "positive" | "negative" | "neutral" {
  if (isBad(value) || value === 0) return "neutral";
  const good = higherIsBetter ? value > 0 : value < 0;
  return good ? "positive" : "negative";
}
