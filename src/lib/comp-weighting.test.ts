import { describe, it, expect } from "vitest";
import { normalizeSize, sizesInTitle, weighComp, weightedQuantile, summarizeComps, type Comp } from "@/lib/comp-weighting";

describe("sizes", () => {
  it("normalizes common size spellings", () => {
    expect(normalizeSize("Medium")).toBe("m");
    expect(normalizeSize("W32 L30")).toBe("32x30");
    expect(normalizeSize("XL")).toBe("xl");
    expect(normalizeSize("10")).toBe("10");
  });
  it("finds sizes in titles", () => {
    expect(sizesInTitle("Levi's 501 Jeans 32x30 Blue")).toEqual(new Set(["32x30"]));
    expect(sizesInTitle("Nike Hoodie Mens Size L Black").has("l")).toBe(true);
  });
});

describe("weighComp", () => {
  const target = { title: "Patagonia Better Sweater Fleece Jacket", brand: "Patagonia", size: "M", condition: "Excellent used", estShipping: 8 };
  it("favours same brand, size and condition", () => {
    const same = weighComp({ title: "Patagonia Better Sweater Fleece Jacket Mens M", price: 60, shipping: 7, conditionId: "3000" }, target);
    const other = weighComp({ title: "North Face Fleece Jacket Mens XL", price: 40, shipping: 7, conditionId: "1000" }, target);
    expect(same.weight).toBeGreaterThan(other.weight * 5);
    expect(same.why).toEqual(expect.arrayContaining(["same brand", "same size", "also used"]));
  });
  it("takes estimated shipping off free-shipping prices", () => {
    expect(weighComp({ title: "Patagonia jacket M", price: 58, shipping: 0, conditionId: "3000" }, target).value).toBe(50);
  });
});

describe("summarizeComps", () => {
  it("returns a weighted range and confidence", () => {
    const comps: Comp[] = [50, 55, 60, 62, 65, 70, 58, 61].map((p) => ({ title: "Patagonia Better Sweater Fleece Jacket M", price: p, shipping: 8, conditionId: "3000" }));
    comps.push({ title: "Lot of 10 fleece jackets", price: 900, shipping: 0, conditionId: "3000" });
    const s = summarizeComps(comps, { title: "Patagonia Better Sweater Fleece Jacket", brand: "Patagonia", size: "M", condition: "Good - minor flaws" })!;
    expect(s.used).toBe(8);
    expect(s.low).toBeLessThanOrEqual(s.typical);
    expect(s.typical).toBeLessThanOrEqual(s.high);
    expect(s.typical).toBeGreaterThanOrEqual(55);
    expect(s.typical).toBeLessThanOrEqual(65);
    expect(s.confidence).toBe("high");
    expect(s.note).toMatch(/not sold prices/);
  });
  it("is low confidence with few, unlike comps", () => {
    const s = summarizeComps([{ title: "Random shirt", price: 20, shipping: null, conditionId: null }], { title: "Patagonia jacket", brand: "Patagonia", size: "M" })!;
    expect(s.confidence).toBe("low");
  });
  it("returns null with nothing usable", () => {
    expect(summarizeComps([], { title: "x" })).toBeNull();
  });
  it("weightedQuantile works", () => {
    expect(weightedQuantile([1, 2, 3], [1, 1, 10], 0.5)).toBe(3);
  });
});
