import type { FactorKey } from "@/types/domain";

/**
 * Chart color tokens.
 *
 * Every value here was run through the data-viz validator against the actual
 * chart surface (DESIGN.md card background `#121826`), not eyeballed:
 *
 *   categorical, 6 slots, dark, adjacent pairs   ALL PASS
 *     worst adjacent CVD dE 8.4 (protan)   >= 8 target
 *     worst adjacent normal-vision dE 19.3 >= 15 floor
 *     all 6 within OKLCH L 0.48-0.67, chroma >= 0.10, contrast >= 3:1
 *
 *   categorical, first 3 slots, --pairs all      ALL PASS
 *     (required for scatter/radar, where any two marks can sit side by side;
 *      those forms therefore cap at 3 series)
 *
 *   ordinal blue ramp, 4 steps, --ordinal        ALL PASS
 *     monotone L, adjacent dL >= 0.06, light end 2.19:1 on surface
 *
 * Slot 1 is DESIGN.md's Financial Blue. The remaining slots are the reference
 * palette's dark steps, kept in their validated ORDER — the order is the
 * CVD-safety mechanism, so it must not be rearranged.
 */

export const CHART_SURFACE = "#121826";
export const PAGE_SURFACE = "#090d16";

/** Reserved status colors from DESIGN.md. Never used as a series identity. */
export const STATUS = {
  positive: "#10b981",
  negative: "#ef4444",
} as const;

/** Chrome. Grid and baseline are deliberately recessive hairlines. */
export const CHROME = {
  primaryInk: "#f1f5f9",
  secondaryInk: "#cbd5e1",
  mutedInk: "#94a3b8",
  gridline: "#1e293b",
  baseline: "#334155",
} as const;

/**
 * The validated categorical order. Index 0..5.
 * Colors are bound to the FACTOR below, never to rank — filtering series must
 * not repaint the survivors.
 */
export const CATEGORICAL = [
  "#3b82f6", // slot 1 blue    — DESIGN.md accent
  "#d95926", // slot 2 orange
  "#199e70", // slot 3 aqua
  "#c98500", // slot 4 yellow
  "#d55181", // slot 5 magenta
  "#008300", // slot 6 green
] as const;

/**
 * Fixed factor -> color assignment. Market takes slot 1 because it is the
 * reference exposure; the five style axes follow in DESIGN.md's radar order.
 */
export const FACTOR_COLORS: Record<FactorKey, string> = {
  market_rf: CATEGORICAL[0],
  hml: CATEGORICAL[1],
  momentum: CATEGORICAL[2],
  quality: CATEGORICAL[3],
  low_vol: CATEGORICAL[4],
  smb: CATEGORICAL[5],
};

/** Mark specs, fixed across every chart. */
export const MARKS = {
  lineWidth: 2,
  /** Bars are capped rather than filling the band — the leftover is air. */
  maxBarWidth: 24,
  /** Rounded data-end, square at the baseline. */
  barRadius: 4,
  markerRadius: 4,
  /** The 2px separator is the surface color, never a stroke around the mark. */
  surfaceGap: 2,
  areaOpacity: 0.1,
} as const;

/**
 * Ordinal ramp for |t-statistic|, one hue, monotone lightness.
 *
 * This encodes a SECOND measure (statistical significance) on top of bar length
 * (the beta itself), so it is not a value-ramp re-encoding what the bar already
 * shows. On a dark surface the anchor flips: the lightest step is the strongest
 * evidence. Buckets are the conventional two-sided critical values.
 */
export const T_STAT_BUCKETS = [
  { min: 0, label: "not significant", sublabel: "|t| < 1.65", color: "#184f95" },
  { min: 1.65, label: "p < 0.10", sublabel: "|t| >= 1.65", color: "#256abf" },
  { min: 1.96, label: "p < 0.05", sublabel: "|t| >= 1.96", color: "#3987e5" },
  { min: 2.58, label: "p < 0.01", sublabel: "|t| >= 2.58", color: "#86b6ef" },
] as const;

export function tStatColor(tStat: number): string {
  // A degenerate regression legitimately yields NaN inference; a recessive gray
  // says "no evidence available" rather than implying the weakest bucket.
  if (!Number.isFinite(tStat)) return CHROME.gridline;
  const magnitude = Math.abs(tStat);
  let color: string = T_STAT_BUCKETS[0].color;
  for (const bucket of T_STAT_BUCKETS) {
    if (magnitude >= bucket.min) color = bucket.color;
  }
  return color;
}

/** Shared Recharts axis/grid props so every chart wears the same chrome. */
export const AXIS_PROPS = {
  stroke: CHROME.baseline,
  tick: { fill: CHROME.mutedInk, fontSize: 11 },
  tickLine: false,
} as const;

export const GRID_PROPS = {
  stroke: CHROME.gridline,
  strokeWidth: 1,
  // Never dashed: dashing reads as "projection" or "threshold" when it is a grid.
  vertical: false,
} as const;
