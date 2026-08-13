import { describe, expect, it } from "vitest";

import {
  BALANCE_EPSILON,
  displayedPercentTotal,
  equalWeights,
  isBalanced,
  percentToWeight,
  rebalanceToOne,
  totalWeight,
  weightToPercentText,
} from "./portfolioWeights";
import type { PortfolioHolding } from "@/types/domain";

const tickers = (n: number): PortfolioHolding[] =>
  Array.from({ length: n }, (_, i) => ({ ticker: `T${i}`, weight: 1 / n }));

describe("percentToWeight / weightToPercentText", () => {
  it("round-trips clean percentages", () => {
    for (const percent of [0, 0.5, 7.5, 12.34, 30, 100]) {
      expect(Number(weightToPercentText(percentToWeight(percent)))).toBeCloseTo(percent, 10);
    }
  });

  it("trims trailing zeros so 7.50 reads as 7.5", () => {
    expect(weightToPercentText(0.075)).toBe("7.5");
    expect(weightToPercentText(0.07)).toBe("7");
    expect(weightToPercentText(0.1234)).toBe("12.34");
  });

  it("snaps beyond two decimals rather than carrying invisible precision", () => {
    // 1/7 of a book would otherwise display as 14.29 while storing 14.2857…
    expect(weightToPercentText(percentToWeight(14.2857))).toBe("14.29");
  });
});

describe("equalWeights", () => {
  // The reported bug: seven equal holdings displayed 14.29% each, which reads as
  // 100.03%, so the sidebar showed an unbalanced book that was actually fine.
  it("sums to exactly 1 for counts that do not divide evenly", () => {
    for (const n of [3, 6, 7, 9, 11, 13, 17, 23]) {
      const equal = equalWeights(tickers(n));
      expect(totalWeight(equal)).toBeCloseTo(1, 12);
      expect(isBalanced(equal)).toBe(true);
    }
  });

  it("makes the DISPLAYED percentages add to exactly 100", () => {
    for (const n of [3, 6, 7, 9, 11, 13, 17, 23]) {
      expect(displayedPercentTotal(equalWeights(tickers(n)))).toBeCloseTo(100, 9);
    }
  });

  it("parks the residual on one holding, leaving the rest identical", () => {
    const equal = equalWeights(tickers(7));
    const counts = new Map<number, number>();
    for (const holding of equal) {
      counts.set(holding.weight, (counts.get(holding.weight) ?? 0) + 1);
    }
    // Six at 14.29% and one absorbing the remainder.
    expect(counts.size).toBe(2);
    expect([...counts.values()].sort()).toEqual([1, 6]);
  });

  it("returns a single holding at 100%", () => {
    expect(equalWeights([{ ticker: "AAPL", weight: 0.4 }])).toEqual([
      { ticker: "AAPL", weight: 1 },
    ]);
  });

  it("handles an empty book", () => {
    expect(equalWeights([])).toEqual([]);
  });
});

describe("rebalanceToOne", () => {
  it("scales an under-allocated book up to 100%", () => {
    const rebalanced = rebalanceToOne([
      { ticker: "A", weight: 0.3 },
      { ticker: "B", weight: 0.3 },
    ]);
    expect(totalWeight(rebalanced)).toBeCloseTo(1, 12);
    expect(displayedPercentTotal(rebalanced)).toBeCloseTo(100, 9);
  });

  it("scales an over-allocated book down to 100%", () => {
    const rebalanced = rebalanceToOne([
      { ticker: "A", weight: 0.8 },
      { ticker: "B", weight: 0.8 },
    ]);
    expect(rebalanced).toEqual([
      { ticker: "A", weight: 0.5 },
      { ticker: "B", weight: 0.5 },
    ]);
  });

  it("preserves relative proportions", () => {
    const rebalanced = rebalanceToOne([
      { ticker: "A", weight: 0.1 },
      { ticker: "B", weight: 0.3 },
    ]);
    // 1:3 must stay 1:3 after rescaling.
    expect((rebalanced[1]?.weight ?? 0) / (rebalanced[0]?.weight ?? 1)).toBeCloseTo(3, 9);
  });

  it("is idempotent on an already-balanced book", () => {
    const once = equalWeights(tickers(7));
    expect(rebalanceToOne(once)).toEqual(once);
  });

  it("keeps the displayed total at 100 across many awkward inputs", () => {
    const awkward: PortfolioHolding[][] = [
      [
        { ticker: "A", weight: 0.333 },
        { ticker: "B", weight: 0.333 },
        { ticker: "C", weight: 0.333 },
      ],
      [
        { ticker: "A", weight: 0.0001 },
        { ticker: "B", weight: 0.9 },
      ],
      Array.from({ length: 31 }, (_, i) => ({ ticker: `T${i}`, weight: 0.07 })),
    ];
    for (const book of awkward) {
      const rebalanced = rebalanceToOne(book);
      expect(totalWeight(rebalanced)).toBeCloseTo(1, 12);
      expect(displayedPercentTotal(rebalanced)).toBeCloseTo(100, 9);
    }
  });

  it("leaves an all-zero book alone instead of inventing weights", () => {
    const zeros = [
      { ticker: "A", weight: 0 },
      { ticker: "B", weight: 0 },
    ];
    expect(rebalanceToOne(zeros)).toEqual(zeros);
  });
});

describe("isBalanced", () => {
  it("accepts float dust from summing hand-entered percentages", () => {
    // 0.14 + 0.13 + 0.12 + 0.1 + 0.1 + 0.09 + 0.08 + 0.08 + 0.08 + 0.08
    const book: PortfolioHolding[] = [0.14, 0.13, 0.12, 0.1, 0.1, 0.09, 0.08, 0.08, 0.08, 0.08].map(
      (weight, i) => ({ ticker: `T${i}`, weight }),
    );
    expect(isBalanced(book)).toBe(true);
  });

  it("rejects a book that is off by a visible amount", () => {
    expect(isBalanced([{ ticker: "A", weight: 0.87 }])).toBe(false);
    expect(isBalanced([{ ticker: "A", weight: 1.05 }])).toBe(false);
  });

  it("rejects a book off by more than half a grid step", () => {
    expect(isBalanced([{ ticker: "A", weight: 1 + BALANCE_EPSILON * 3 }])).toBe(false);
  });
});
