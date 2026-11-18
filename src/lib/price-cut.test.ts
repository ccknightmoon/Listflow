import { describe, it, expect } from "vitest";
import { planPriceCut, summarizeCut } from "./price-cut";

const items = [
  { id: "a", title: "Tee", price: 27.99 },
  { id: "b", title: "Jacket", price: 30, costBasis: 25 },
  { id: "c", title: "Hat", price: 1.5 },
  { id: "d", title: "No price", price: null },
];

describe("price cuts", () => {
  it("-15% preset, exact cents", () => {
    const r = planPriceCut([items[0]], { mode: "percent", value: -15 });
    expect(r[0]).toMatchObject({ from: 27.99, to: 23.79 }); // 2379.15 -> 2379
  });
  it("never below the item's cost, the floor, or $0.99", () => {
    const r = planPriceCut(items, { mode: "percent", value: -20 }, 10);
    expect(r.find((x) => x.id === "b")).toMatchObject({ to: 25, limitedBy: "cost" }); // 24.00 -> cost 25
    expect(r.find((x) => x.id === "a")).toMatchObject({ to: 22.39 });
    expect(r.find((x) => x.id === "c")).toMatchObject({ to: null, reason: "at_floor" }); // 1.20 -> floor 10 >= 1.50
    expect(r.find((x) => x.id === "d")).toMatchObject({ to: null, reason: "no_price" });
  });
  it("never raises a price (set to a higher $ is skipped)", () => {
    expect(planPriceCut([items[0]], { mode: "set", value: 35 })[0]).toMatchObject({ to: null, reason: "no_change" });
  });
  it("-$ and set $ work, summary adds up exactly", () => {
    const r = planPriceCut([items[0], items[1]], { mode: "add", value: -3.33 });
    expect(r.map((x) => x.to)).toEqual([24.66, 26.67]);
    expect(summarizeCut(r)).toEqual({ changing: 2, skipped: 0, atFloor: 0, limited: 0, totalReduction: 6.66 });
  });
});

import { needsTypedConfirm, typedConfirmMatches, BULK_CONFIRM_AT } from "./price-cut";
describe("bulk price-drop safety", () => {
  it("asks for a typed confirmation from 20 listings up", () => {
    expect(needsTypedConfirm(BULK_CONFIRM_AT - 1)).toBe(false);
    expect(needsTypedConfirm(BULK_CONFIRM_AT)).toBe(true);
    expect(needsTypedConfirm(896)).toBe(true);
  });
  it("only the exact count confirms", () => {
    expect(typedConfirmMatches("896", 896)).toBe(true);
    expect(typedConfirmMatches(" 896 listings", 896)).toBe(true);
    expect(typedConfirmMatches("89", 896)).toBe(false);
    expect(typedConfirmMatches("", 896)).toBe(false);
    expect(typedConfirmMatches("yes", 896)).toBe(false);
  });
});
