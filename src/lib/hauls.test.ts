import { describe, expect, it } from "vitest";
import { haulBodyError, haulSummary, itemProfit, splitHaulCost } from "./hauls";

const sum = (o: Record<string, number>) => Math.round(Object.values(o).reduce((s, v) => s + v, 0) * 100) / 100;

describe("splitHaulCost", () => {
  it("even split adds up to the cent", () => {
    const r = splitHaulCost(100, [{ id: "a", price: null }, { id: "b", price: null }, { id: "c", price: null }], "even");
    expect(sum(r)).toBe(100);
    expect(Object.values(r).sort()).toEqual([33.33, 33.33, 33.34]);
  });
  it("price split weighs by list price", () => {
    const r = splitHaulCost(30, [{ id: "a", price: 40 }, { id: "b", price: 20 }], "price");
    expect(r).toEqual({ a: 20, b: 10 });
  });
  it("unpriced items get an average weight", () => {
    const r = splitHaulCost(30, [{ id: "a", price: 40 }, { id: "b", price: 20 }, { id: "c", price: null }], "price");
    expect(sum(r)).toBe(30);
    expect(r.c).toBe(10);
  });
  it("price mode with no prices falls back to even", () => {
    expect(splitHaulCost(10, [{ id: "a", price: 0 }, { id: "b", price: null }], "price")).toEqual({ a: 5, b: 5 });
  });
  it("handles empty and zero", () => {
    expect(splitHaulCost(10, [], "even")).toEqual({});
    expect(splitHaulCost(0, [{ id: "a", price: 3 }], "even")).toEqual({ a: 0 });
    expect(splitHaulCost(Number.NaN, [{ id: "a", price: 3 }], "even")).toEqual({ a: 0 });
  });
  it("never produces negative or lost cents on awkward totals", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ id: String(i), price: i * 3.17 }));
    const r = splitHaulCost(123.45, items, "price");
    expect(sum(r)).toBe(123.45);
    for (const v of Object.values(r)) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe("haulSummary", () => {
  const drafts = [
    { id: "1", haulId: "h", title: "A", costBasis: 2, listingId: "111", price: 30 },
    { id: "2", haulId: "h", title: "B", costBasis: 2, listingId: "222", price: 20 },
    { id: "3", haulId: "h", title: "C", costBasis: 2, listingId: null, price: null },
    { id: "4", haulId: "other", title: "D", costBasis: 5, listingId: "333", price: 10 },
  ];
  const sales = [{ listingId: "111", itemTotal: 30, fee: 4 }, { listingId: "333", itemTotal: 10, fee: 1 }];
  it("counts only the haul's items and sales", () => {
    const s = haulSummary({ id: "h", totalCost: 6 }, drafts, sales);
    expect(s).toMatchObject({ items: 3, listed: 2, sold: 1, grossOut: 30, feesOut: 4, netOut: 26, profit: 24, unsoldCost: 4, costIn: 6 });
    expect(s.sellThrough).toBeCloseTo(1 / 3);
    expect(s.roi).toBeCloseTo(26 / 6);
  });
  it("roi is null for a free haul", () => {
    expect(haulSummary({ id: "h", totalCost: 0 }, drafts, sales).roi).toBeNull();
  });
  it("itemProfit", () => {
    expect(itemProfit(drafts[0], sales)).toBe(24);
    expect(itemProfit(drafts[1], sales)).toBeNull();
    expect(itemProfit(drafts[2], sales)).toBeNull();
  });
});

describe("haulBodyError", () => {
  it("validates", () => {
    expect(haulBodyError({ name: "Rag house", totalCost: 120 })).toBeNull();
    expect(haulBodyError({ name: "", totalCost: 1 })).toMatch(/name/);
    expect(haulBodyError({ name: "x", totalCost: -1 })).toMatch(/cost/);
    expect(haulBodyError({ name: "x", totalCost: 1, boughtOn: "11/26" })).toMatch(/Date/);
    expect(haulBodyError({ name: "x", totalCost: 1, splitMode: "weird" })).toMatch(/Split/);
    expect(haulBodyError({ notes: "ok" }, true)).toBeNull();
  });
});
