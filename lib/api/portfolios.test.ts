import { describe, expect, it } from "vitest";

import { holdingsToWeights, rowToPortfolio, weightsToHoldings } from "./portfolios";
import type { PortfolioRow } from "@/types/database";

describe("weightsToHoldings", () => {
  it("sorts by descending weight", () => {
    // Largest positions first is how a PM reads a book.
    expect(weightsToHoldings({ AAPL: 0.1, NVDA: 0.5, MSFT: 0.4 })).toEqual([
      { ticker: "NVDA", weight: 0.5 },
      { ticker: "MSFT", weight: 0.4 },
      { ticker: "AAPL", weight: 0.1 },
    ]);
  });

  it("breaks weight ties by ticker for a stable order", () => {
    expect(weightsToHoldings({ MSFT: 0.5, AAPL: 0.5 }).map((h) => h.ticker)).toEqual([
      "AAPL",
      "MSFT",
    ]);
  });

  it("drops non-finite weights instead of emitting NaN holdings", () => {
    expect(weightsToHoldings({ AAPL: 0.5, BAD: Number.NaN })).toEqual([
      { ticker: "AAPL", weight: 0.5 },
    ]);
  });

  it("tolerates an empty or missing map", () => {
    expect(weightsToHoldings({})).toEqual([]);
    expect(weightsToHoldings(undefined as unknown as Record<string, number>)).toEqual([]);
  });
});

describe("holdingsToWeights", () => {
  it("round-trips through weightsToHoldings", () => {
    const weights = { AAPL: 0.6, MSFT: 0.4 };
    expect(holdingsToWeights(weightsToHoldings(weights))).toEqual(weights);
  });
});

describe("rowToPortfolio", () => {
  it("maps a row to the domain shape", () => {
    const row: PortfolioRow = {
      id: "00000000-0000-4000-8000-000000000001",
      user_id: null,
      name: "Demo",
      weights_json: { AAPL: 0.6, MSFT: 0.4 },
      created_at: "2026-08-13T00:00:00Z",
    };

    expect(rowToPortfolio(row)).toEqual({
      id: row.id,
      userId: null,
      name: "Demo",
      holdings: [
        { ticker: "AAPL", weight: 0.6 },
        { ticker: "MSFT", weight: 0.4 },
      ],
      createdAt: row.created_at,
    });
  });
});
