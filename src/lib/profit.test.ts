import { describe, it, expect } from "vitest";
import { isValidCostBasis, summarizeCost } from "./profit";

describe("isValidCostBasis", () => {
  it("accepts zero and positive finite numbers", () => {
    expect(isValidCostBasis(0)).toBe(true);
    expect(isValidCostBasis(12.5)).toBe(true);
  });

  it("rejects negative numbers, non-numbers, NaN, and Infinity", () => {
    expect(isValidCostBasis(-1)).toBe(false);
    expect(isValidCostBasis(NaN)).toBe(false);
    expect(isValidCostBasis(Infinity)).toBe(false);
    expect(isValidCostBasis(null)).toBe(false);
    expect(isValidCostBasis(undefined)).toBe(false);
    expect(isValidCostBasis("5")).toBe(false);
  });
});

describe("summarizeCost", () => {
  it("returns all zeros for an empty list", () => {
    expect(summarizeCost([])).toEqual({ totalCost: 0, itemsWithCost: 0, itemsMissingCost: 0 });
  });

  it("treats every missing cost as excluded, not zero", () => {
    const result = summarizeCost([{ costBasis: null }, { costBasis: null }]);
    expect(result).toEqual({ totalCost: 0, itemsWithCost: 0, itemsMissingCost: 2 });
  });

  it("sums only the sales that have a cost entered", () => {
    const result = summarizeCost([
      { costBasis: 10 },
      { costBasis: null },
      { costBasis: 5.5 },
    ]);
    expect(result.totalCost).toBeCloseTo(15.5);
    expect(result.itemsWithCost).toBe(2);
    expect(result.itemsMissingCost).toBe(1);
  });

  it("counts an explicit $0 cost as entered, not missing", () => {
    const result = summarizeCost([{ costBasis: 0 }]);
    expect(result.itemsWithCost).toBe(1);
    expect(result.itemsMissingCost).toBe(0);
  });
});
