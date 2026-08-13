import { describe, expect, it } from "vitest";

import { describeCoverageGaps } from "./factorEngine";

/**
 * The heuristic has to separate two causes with the same symptom:
 *   - differing US/KRX holiday calendars, which cost ~24 dates a year and are
 *     nothing to act on;
 *   - a holding whose price history starts after the window, which invalidates
 *     the whole comparison and needs the user to change something.
 *
 * Measured baseline: AAPL vs 005930.KS over ~3 years shares 704 of 776 dates.
 */
describe("describeCoverageGaps", () => {
  it("calls a real 3-year mixed US/KRX book normal", () => {
    // The exact case measured against live data: 71 dropped over 774 dates, with
    // the Korean leg absent on 48 US-trading days.
    const message = describeCoverageGaps(
      71,
      [
        { ticker: "005930.KS", missingDates: 48 },
        { ticker: "AAPL", missingDates: 23 },
      ],
      774,
    );
    expect(message).toContain("normal cost of mixing US and KRX");
    expect(message).not.toContain("starts after the window");
  });

  it("flags a holding whose history starts mid-window", () => {
    // LG Energy Solution listed in 2022; a 2013-start window loses everything
    // before that.
    const message = describeCoverageGaps(
      2064,
      [
        { ticker: "373220.KS", missingDates: 2064 },
        { ticker: "207940.KS", missingDates: 785 },
      ],
      3170,
    );
    expect(message).toContain("373220.KS alone is missing 2064 of 3170 dates");
    expect(message).toContain("starts after the window");
    expect(message).toContain("12.6 years");
  });

  it("does not scale its expectation off the drop count", () => {
    // The circular version derived the calendar budget from `droppedCount`, so a
    // huge drop justified itself as normal. Same drops, a window far too short to
    // explain them, must be flagged.
    const gaps = [{ ticker: "SHORT", missingDates: 500 }];
    expect(describeCoverageGaps(500, gaps, 600)).toContain("starts after the window");
  });

  it("stays quiet on a one-year mixed book", () => {
    const message = describeCoverageGaps(
      24,
      [
        { ticker: "005930.KS", missingDates: 16 },
        { ticker: "AAPL", missingDates: 8 },
      ],
      252,
    );
    expect(message).toContain("normal cost");
  });

  it("flags a recent listing inside a one-year window", () => {
    // Half a year of history missing is not a holiday calendar.
    const message = describeCoverageGaps(
      126,
      [{ ticker: "NEWCO", missingDates: 126 }],
      252,
    );
    expect(message).toContain("starts after the window");
  });

  it("names the worst offenders and counts the rest", () => {
    const message = describeCoverageGaps(
      10,
      [
        { ticker: "A", missingDates: 5 },
        { ticker: "B", missingDates: 4 },
        { ticker: "C", missingDates: 3 },
        { ticker: "D", missingDates: 2 },
        { ticker: "E", missingDates: 1 },
      ],
      500,
    );
    expect(message).toContain("A (5), B (4), C (3), +2 more");
  });

  it("handles an empty gap list without claiming a culprit", () => {
    const message = describeCoverageGaps(0, [], 500);
    expect(message).toContain("Largest gaps: none");
    expect(message).not.toContain("alone is missing");
  });
});
