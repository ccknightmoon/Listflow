import { describe, it, expect } from "vitest";
import {
  estimateWeightLb,
  shippingCostForWeight,
  estimatePackage,
  estimateShipping,
  parseShippingMode,
} from "./shipping";

describe("estimateWeightLb", () => {
  it("falls back to the default clothing weight for an unrecognized item type", () => {
    expect(estimateWeightLb(null, null, null)).toBeCloseTo(0.8 + 0.3, 5);
  });

  it("picks a heavier weight for a coat than a t-shirt", () => {
    expect(estimateWeightLb("Coat")).toBeGreaterThan(estimateWeightLb("T-Shirt"));
  });

  it("scales up with size and heavy materials", () => {
    const small = estimateWeightLb("Jacket", "S", null);
    const xxl = estimateWeightLb("Jacket", "XXL", null);
    expect(xxl).toBeGreaterThan(small);

    const cotton = estimateWeightLb("Jacket", "M", "cotton");
    const leather = estimateWeightLb("Jacket", "M", "leather");
    expect(leather).toBeGreaterThan(cotton);
  });
});

describe("shippingCostForWeight", () => {
  it("uses the correct band at each boundary", () => {
    expect(shippingCostForWeight(1)).toBe(8);
    expect(shippingCostForWeight(1.01)).toBe(9);
    expect(shippingCostForWeight(2)).toBe(9);
    expect(shippingCostForWeight(2.01)).toBe(10);
    expect(shippingCostForWeight(10)).toBe(16);
    expect(shippingCostForWeight(10.01)).toBe(22);
    expect(shippingCostForWeight(50)).toBe(22);
  });
});

describe("estimatePackage", () => {
  it("returns a bigger box for a heavier item", () => {
    const light = estimatePackage(0.5);
    const heavy = estimatePackage(8);
    expect(heavy.lengthIn).toBeGreaterThan(light.lengthIn);
  });
});

describe("estimateShipping", () => {
  it("flags a heavy item once cost clears the free-shipping baseline", () => {
    const tee = estimateShipping("T-Shirt", "M", "cotton");
    expect(tee.isHeavy).toBe(false);
    const coat = estimateShipping("Coat", "XL", "wool");
    expect(coat.isHeavy).toBe(true);
    expect(coat.cost).toBeGreaterThan(8);
  });
});

describe("parseShippingMode", () => {
  it("recognizes the two non-default modes", () => {
    expect(parseShippingMode("buyer_pays")).toBe("buyer_pays");
    expect(parseShippingMode("calculated")).toBe("calculated");
  });

  it("defaults anything else to 'free'", () => {
    expect(parseShippingMode("free")).toBe("free");
    expect(parseShippingMode(undefined)).toBe("free");
    expect(parseShippingMode(null)).toBe("free");
    expect(parseShippingMode("nonsense")).toBe("free");
    expect(parseShippingMode(123)).toBe("free");
  });
});
