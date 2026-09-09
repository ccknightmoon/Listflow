import { describe, it, expect } from "vitest";
import {
  EBAY_STANDARD_FEE_PERCENT,
  estimateEbayPerOrderFee,
  estimateEbayFee,
  isValidFeePercent,
} from "./ebay-fees";

describe("estimateEbayPerOrderFee", () => {
  it("charges $0.30 for orders at or under $10", () => {
    expect(estimateEbayPerOrderFee(10)).toBeCloseTo(0.3);
    expect(estimateEbayPerOrderFee(5)).toBeCloseTo(0.3);
    expect(estimateEbayPerOrderFee(0)).toBeCloseTo(0.3);
  });

  it("charges $0.40 for orders over $10", () => {
    expect(estimateEbayPerOrderFee(10.01)).toBeCloseTo(0.4);
    expect(estimateEbayPerOrderFee(100)).toBeCloseTo(0.4);
  });
});

describe("estimateEbayFee", () => {
  it("returns 0 for a non-positive order total", () => {
    expect(estimateEbayFee(0, EBAY_STANDARD_FEE_PERCENT)).toBe(0);
    expect(estimateEbayFee(-5, EBAY_STANDARD_FEE_PERCENT)).toBe(0);
  });

  it("combines the percentage cut and the per-order fee at the $10 boundary", () => {
    // $10 order, 13.6% -> $1.36 + $0.30 per-order fee
    expect(estimateEbayFee(10, 13.6)).toBeCloseTo(1.66, 5);
    // just over $10 -> per-order fee steps up to $0.40
    expect(estimateEbayFee(10.01, 13.6)).toBeCloseTo(10.01 * 0.136 + 0.4, 5);
  });

  it("scales with a custom (seller-overridden) fee percentage", () => {
    expect(estimateEbayFee(100, 10)).toBeCloseTo(100 * 0.1 + 0.4, 5);
    expect(estimateEbayFee(100, 0)).toBeCloseTo(0.4, 5);
  });
});

describe("isValidFeePercent", () => {
  it("accepts numbers within [0, 100]", () => {
    expect(isValidFeePercent(0)).toBe(true);
    expect(isValidFeePercent(13.6)).toBe(true);
    expect(isValidFeePercent(100)).toBe(true);
  });

  it("rejects out-of-range or non-numeric values", () => {
    expect(isValidFeePercent(-0.01)).toBe(false);
    expect(isValidFeePercent(100.01)).toBe(false);
    expect(isValidFeePercent(NaN)).toBe(false);
    expect(isValidFeePercent(Infinity)).toBe(false);
    expect(isValidFeePercent("13.6")).toBe(false);
    expect(isValidFeePercent(null)).toBe(false);
    expect(isValidFeePercent(undefined)).toBe(false);
  });
});
