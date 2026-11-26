import { describe, expect, it } from "vitest";
import { compareBins, groupByBin, normalizeBin, sortPickList } from "./bins";

describe("bins", () => {
  it("normalizes", () => {
    expect(normalizeBin(" b3 ")).toBe("B3");
    expect(normalizeBin("tote   12")).toBe("TOTE 12");
    expect(normalizeBin("")).toBeNull();
    expect(normalizeBin(null)).toBeNull();
    expect(normalizeBin(5)).toBeUndefined();
    expect(normalizeBin("x".repeat(25))).toBeUndefined();
    expect(normalizeBin("<b>")).toBeUndefined();
  });
  it("natural order, empty last", () => {
    expect(["A10", null, "B1", "A2"].sort(compareBins)).toEqual(["A2", "A10", "B1", null]);
  });
  it("pick list sorts and groups", () => {
    const rows = [
      { key: "1", bin: "B1", sku: "S2", title: "x" },
      { key: "2", bin: null, sku: "S1", title: "y" },
      { key: "3", bin: "A2", sku: "S9", title: "z" },
      { key: "4", bin: "B1", sku: "S1", title: "w" },
    ];
    expect(sortPickList(rows).map((r) => r.key)).toEqual(["3", "4", "1", "2"]);
    expect(groupByBin(rows).map((g) => [g.bin, g.rows.length])).toEqual([["A2", 1], ["B1", 2], [null, 1]]);
    expect(rows[0].key).toBe("1"); // not mutated
  });
});
