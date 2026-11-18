import { describe, it, expect } from "vitest";
import { buildGroupsFromDividers, countMarkedItems } from "./manual-dividers";

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe("manual dividers", () => {
  it("'new item starts here' keeps the photo: jacket 0-9, jersey 10-27", () => {
    expect(buildGroupsFromDividers(new Set(), new Set([10]), 28)).toEqual([range(0, 9), range(10, 27)]);
  });
  it("SKU photo ends the item and is excluded (unchanged behaviour)", () => {
    expect(buildGroupsFromDividers(new Set([4]), new Set(), 9)).toEqual([[0, 1, 2, 3], [5, 6, 7, 8]]);
    expect(buildGroupsFromDividers(new Set([3, 8]), new Set(), 9)).toEqual([[0, 1, 2], [4, 5, 6, 7]]);
  });
  it("mixes both kinds", () => {
    expect(buildGroupsFromDividers(new Set([5]), new Set([3, 6]), 9)).toEqual([[0, 1, 2], [3, 4], [6, 7, 8]]);
  });
  it("a start marker on photo 0, or right after a SKU photo, doesn't create an empty item", () => {
    expect(buildGroupsFromDividers(new Set([2]), new Set([0, 3]), 5)).toEqual([[0, 1], [3, 4]]);
    expect(countMarkedItems(new Set(), new Set([0]), 3)).toBe(1);
  });
});
