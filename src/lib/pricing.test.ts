import { describe, it, expect } from "vitest";
import { computeListAndFloor, getPriceSuggestion } from "./pricing";

describe("computeListAndFloor", () => {
  it("grosses up the target value + shipping for eBay's fee, then floors/rounds", () => {
    const { listPrice, floorPrice } = computeListAndFloor(30, 8);
    const breakEven = (30 + 8) / (1 - 0.135); // 43.93...
    expect(floorPrice).toBe(Math.round(breakEven));
    expect(listPrice).toBeGreaterThan(floorPrice);
  });

  it("the floor is always the break-even point (covers target + shipping + fee, no margin)", () => {
    const { floorPrice } = computeListAndFloor(0, 0);
    expect(floorPrice).toBe(0);
  });

  it("applies at least a $4 margin above the floor even on a small item", () => {
    const { listPrice, floorPrice } = computeListAndFloor(5, 0);
    expect(listPrice - floorPrice).toBeGreaterThanOrEqual(4);
  });

  it("margin scales up (15% of break-even) for a higher-value item", () => {
    const { listPrice, floorPrice } = computeListAndFloor(500, 0);
    const margin = listPrice - floorPrice;
    expect(margin).toBeGreaterThan(4);
    expect(margin).toBeCloseTo(Math.round(floorPrice * 0.15), 0);
  });
});

describe("getPriceSuggestion", () => {
  it("prices better condition higher than worse condition", () => {
    const newWithTags = getPriceSuggestion("New with tags", false);
    const fair = getPriceSuggestion("Fair - notable flaws", false);
    expect(newWithTags.suggestedPrice).toBeGreaterThan(fair.suggestedPrice);
  });

  it("flaws lower the price and drop sell odds to Medium", () => {
    const clean = getPriceSuggestion("Excellent used", false);
    const flawed = getPriceSuggestion("Excellent used", true);
    expect(flawed.suggestedPrice).toBeLessThan(clean.suggestedPrice);
    expect(flawed.sellOdds).toBe("Medium");
    expect(clean.sellOdds).toBe("High");
  });

  it("always returns a floorPrice below the suggested/list price", () => {
    const result = getPriceSuggestion("Good - minor flaws", false, false, "Jacket", "M");
    expect(result.floorPrice).toBeDefined();
    expect(result.floorPrice as number).toBeLessThan(result.suggestedPrice);
  });

  it("does not double-charge shipping for heavy items (isHeavy=true skips folding shipping into price)", () => {
    const heavy = getPriceSuggestion("Excellent used", false, true, "Coat", "M");
    const notHeavy = getPriceSuggestion("Excellent used", false, false, "Coat", "M");
    // Heavy items ship "buyer pays" separately, so the item price itself
    // shouldn't need to recover the shipping cost the way a free-shipping
    // (non-heavy) listing does.
    expect(heavy.suggestedPrice).toBeLessThanOrEqual(notHeavy.suggestedPrice);
  });
});
