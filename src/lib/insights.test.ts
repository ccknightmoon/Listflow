import { describe, it, expect } from "vitest";
import { groupSalesByCategory } from "./insights";

describe("groupSalesByCategory", () => {
  it("returns an empty list for no sales", () => {
    expect(groupSalesByCategory([])).toEqual([]);
  });

  it("groups a single sale into one category", () => {
    const result = groupSalesByCategory([
      { category: "Dresses", total: 40, costBasis: 10, soldAt: "2026-01-10T00:00:00Z", listedAt: "2026-01-05T00:00:00Z" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: "Dresses",
      count: 1,
      revenue: 40,
      totalCost: 10,
      itemsWithCost: 1,
      salesWithDays: 1,
    });
    expect(result[0].marginPercent).toBeCloseTo(75); // (40-10)/40
    expect(result[0].avgDaysToSell).toBeCloseTo(5);
  });

  it("falls back to Uncategorized for a null category, and sorts by revenue descending", () => {
    const result = groupSalesByCategory([
      { category: null, total: 100, costBasis: null, soldAt: "2026-01-10T00:00:00Z", listedAt: null },
      { category: "Shoes", total: 20, costBasis: null, soldAt: "2026-01-10T00:00:00Z", listedAt: null },
    ]);
    expect(result[0].category).toBe("Uncategorized");
    expect(result[0].revenue).toBe(100);
    expect(result[1].category).toBe("Shoes");
  });

  it("reports margin as null (not 0) when nothing in the group has a cost", () => {
    const result = groupSalesByCategory([
      { category: "Purses", total: 50, costBasis: null, soldAt: "2026-01-10T00:00:00Z", listedAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(result[0].marginPercent).toBeNull();
    expect(result[0].itemsWithCost).toBe(0);
  });

  it("reports avgDaysToSell as null when nothing in the group has a listedAt", () => {
    const result = groupSalesByCategory([
      { category: "Hoodies", total: 30, costBasis: 5, soldAt: "2026-01-10T00:00:00Z", listedAt: null },
    ]);
    expect(result[0].avgDaysToSell).toBeNull();
    expect(result[0].salesWithDays).toBe(0);
    // Cost/margin math is independent of the date data and still works.
    expect(result[0].marginPercent).toBeCloseTo((30 - 5) / 30 * 100);
  });

  it("excludes a negative days-to-sell sale from the average but keeps it in revenue and cost", () => {
    const result = groupSalesByCategory([
      { category: "Boxes", total: 20, costBasis: 5, soldAt: "2026-01-01T00:00:00Z", listedAt: "2026-02-01T00:00:00Z" }, // listedAt AFTER soldAt
      { category: "Boxes", total: 10, costBasis: 2, soldAt: "2026-01-10T00:00:00Z", listedAt: "2026-01-05T00:00:00Z" }, // valid, 5 days
    ]);
    expect(result[0].count).toBe(2);
    expect(result[0].revenue).toBe(30);
    expect(result[0].totalCost).toBe(7);
    expect(result[0].salesWithDays).toBe(1);
    expect(result[0].avgDaysToSell).toBeCloseTo(5);
  });

  it("computes margin only over the sales that have a cost, not the whole group", () => {
    const result = groupSalesByCategory([
      { category: "Watches", total: 100, costBasis: 20, soldAt: "2026-01-10T00:00:00Z", listedAt: null }, // 80% margin
      { category: "Watches", total: 50, costBasis: null, soldAt: "2026-01-10T00:00:00Z", listedAt: null }, // no cost
    ]);
    // Margin should be based only on the $100/$20 pair, not diluted by the
    // $50 sale with no known cost.
    expect(result[0].marginPercent).toBeCloseTo(80);
    expect(result[0].itemsWithCost).toBe(1);
    expect(result[0].revenue).toBe(150);
  });
});
