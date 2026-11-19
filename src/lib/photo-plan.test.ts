import { describe, it, expect } from "vitest";
import { planDetail, MAX_ANALYSIS_PHOTOS, MAX_HIGH_DETAIL } from "./photo-plan";

describe("every photo analyzed, the right ones at full detail", () => {
  it("small items: all photos at full detail", () => {
    expect(planDetail(5)).toEqual(["high", "high", "high", "high", "high"]);
  });
  it("10 photos: front + tag shots high, the rest low", () => {
    const p = planDetail(10, { front: 0, tags: [7, 8, 9] });
    expect(p).toHaveLength(10);
    expect(p.map((d, i) => (d === "high" ? i : -1)).filter((i) => i >= 0)).toEqual([0, 7, 8, 9]);
  });
  it("never more than 6 high; junk indexes ignored", () => {
    const p = planDetail(12, { front: 3, tags: [0, 1, 2, 4, 5, 6, 7, 99, -1, "x"] });
    expect(p.filter((d) => d === "high")).toHaveLength(MAX_HIGH_DETAIL);
    expect(p[3]).toBe("high");
  });
  it("without a finder answer: front + last shots (where tags usually are)", () => {
    const p = planDetail(9, null);
    expect(p.map((d, i) => (d === "high" ? i : -1)).filter((i) => i >= 0)).toEqual([0, 1, 2, 6, 7, 8]);
  });
  it("caps photos per item", () => {
    expect(planDetail(40)).toHaveLength(MAX_ANALYSIS_PHOTOS);
  });
});
