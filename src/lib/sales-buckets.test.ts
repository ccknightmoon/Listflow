import { describe, it, expect } from "vitest";
import { bucketRevenue, formatCompactCurrency } from "./sales-buckets";

const DAY_MS = 86400000;

describe("bucketRevenue", () => {
  it("returns all-zero buckets for an empty sales list", () => {
    const { totals } = bucketRevenue([], 30);
    expect(totals.every((t) => t === 0)).toBe(true);
    expect(totals.length).toBeGreaterThan(0);
  });

  it("buckets a 7-day-or-shorter window by day, most recent bucket last", () => {
    const now = Date.now();
    const { totals } = bucketRevenue(
      [{ soldAt: new Date(now).toISOString(), total: 25 }],
      7
    );
    expect(totals.length).toBe(7);
    expect(totals[totals.length - 1]).toBe(25);
    expect(totals.slice(0, -1).every((t) => t === 0)).toBe(true);
  });

  it("buckets a longer window by week", () => {
    const now = Date.now();
    const { totals } = bucketRevenue(
      [{ soldAt: new Date(now).toISOString(), total: 100 }],
      30
    );
    // 30 days / 7-day weeks -> 5 buckets (ceil(30/7))
    expect(totals.length).toBe(5);
    expect(totals[totals.length - 1]).toBe(100);
  });

  it("sums multiple sales landing in the same bucket", () => {
    const now = Date.now();
    const { totals } = bucketRevenue(
      [
        { soldAt: new Date(now).toISOString(), total: 10 },
        { soldAt: new Date(now - DAY_MS * 0.1).toISOString(), total: 15 },
      ],
      7
    );
    expect(totals[totals.length - 1]).toBe(25);
  });

  it("drops a sale that falls outside the requested window", () => {
    const now = Date.now();
    const { totals } = bucketRevenue(
      [{ soldAt: new Date(now - DAY_MS * 100).toISOString(), total: 999 }],
      7
    );
    expect(totals.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("formatCompactCurrency", () => {
  it("shows whole dollars under $1,000", () => {
    expect(formatCompactCurrency(342)).toBe("$342");
    expect(formatCompactCurrency(0)).toBe("$0");
  });

  it("shows one decimal 'k' between $1,000 and $10,000", () => {
    expect(formatCompactCurrency(1234)).toBe("$1.2k");
  });

  it("shows whole 'k' at $10,000 and above", () => {
    expect(formatCompactCurrency(12345)).toBe("$12k");
  });
});
