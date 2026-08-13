import type { PortfolioHolding } from "@/types/domain";

/**
 * Weight arithmetic for the portfolio builder.
 *
 * Extracted from the UI because this is exactly the kind of code that breaks
 * silently: weights are edited as percentages but stored as fractions, and any
 * mismatch between the number a user reads and the number that gets analysed
 * corrupts every downstream return.
 *
 * THE RULE: weights snap to the same grid the UI displays.
 *
 * An unrounded equal weighting of 7 names is 1/7 = 0.142857…, which renders as
 * "14.29%" seven times — visibly 100.03% — even though the stored weights sum to
 * exactly 1. Snapping to the displayed precision makes what the user reads add up.
 */

/** Percent inputs are held to 2 decimals, so weights live on a 1e-4 grid. */
export const PERCENT_DECIMALS = 2;

export const WEIGHT_GRID = 100 * 10 ** PERCENT_DECIMALS;

/** Half a grid step: anything closer than this to 1.0 is balanced. */
export const BALANCE_EPSILON = 1 / (2 * WEIGHT_GRID);

/** Snap a fraction onto the display grid. */
function snap(weight: number): number {
  return Math.round(weight * WEIGHT_GRID) / WEIGHT_GRID;
}

export function percentToWeight(percent: number): number {
  return snap(percent / 100);
}

/** Canonical display string: trailing zeros trimmed, so 7.50 reads as "7.5". */
export function weightToPercentText(weight: number): string {
  return String(Number((weight * 100).toFixed(PERCENT_DECIMALS)));
}

export function totalWeight(holdings: readonly PortfolioHolding[]): number {
  return holdings.reduce((sum, holding) => sum + holding.weight, 0);
}

export function isBalanced(holdings: readonly PortfolioHolding[]): boolean {
  return Math.abs(1 - totalWeight(holdings)) < BALANCE_EPSILON;
}

/**
 * Rescale weights to sum to exactly 1 ON THE DISPLAY GRID.
 *
 * Rounding each weight independently leaves a residual of up to n/2 grid steps.
 * That residual is parked on the largest holding, where it is proportionally
 * smallest and least likely to shift a rounded display value.
 *
 * Returns the input unchanged when the total is not positive — there is no
 * meaningful rescaling of an all-zero book, and inventing one would be worse
 * than leaving it visibly broken.
 */
export function rebalanceToOne(
  holdings: readonly PortfolioHolding[],
): PortfolioHolding[] {
  const total = totalWeight(holdings);
  if (!(total > 0)) return holdings.map((h) => ({ ...h }));

  const snapped = holdings.map((holding) => ({
    ticker: holding.ticker,
    weight: snap(holding.weight / total),
  }));

  const residual = snap(1 - totalWeight(snapped));
  if (residual === 0) return snapped;

  let largest = 0;
  for (let i = 1; i < snapped.length; i++) {
    if ((snapped[i]?.weight ?? 0) > (snapped[largest]?.weight ?? 0)) largest = i;
  }
  const target = snapped[largest];
  if (target) target.weight = snap(target.weight + residual);

  return snapped;
}

/** Equal weights that also add to exactly 100% on the display grid. */
export function equalWeights(
  holdings: readonly PortfolioHolding[],
): PortfolioHolding[] {
  if (holdings.length === 0) return [];
  return rebalanceToOne(holdings.map((holding) => ({ ticker: holding.ticker, weight: 1 })));
}

/** Sum of the values as they are DISPLAYED, in percent. */
export function displayedPercentTotal(holdings: readonly PortfolioHolding[]): number {
  return holdings.reduce(
    (sum, holding) => sum + Number(weightToPercentText(holding.weight)),
    0,
  );
}
