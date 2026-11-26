import { describe, expect, it } from "vitest";
import { activeRules, applyLearnedFixes, diffCorrections } from "./learned-fixes";

describe("diffCorrections", () => {
  it("records only learnable fields that changed from a real value", () => {
    const before = { brand: "Polo RL", size: "L", color: "", material: "Cotton", item_type: "Polo" };
    const body = { brand: "Polo Ralph Lauren", size: "XL", color: "Blue", material: "Cotton", itemType: "Polo Shirt", condition: "x" };
    expect(diffCorrections(before, body)).toEqual([
      { field: "brand", from: "Polo RL", to: "Polo Ralph Lauren" },
      { field: "item_type", from: "Polo", to: "Polo Shirt" },
    ]);
  });
  it("ignores fields not in the body and clearing a value", () => {
    expect(diffCorrections({ brand: "Nike" }, {})).toEqual([]);
    expect(diffCorrections({ brand: "Nike" }, { brand: "" })).toEqual([]);
  });
});

describe("activeRules", () => {
  it("needs 2 repeats and a clear winner", () => {
    expect(activeRules([{ field: "brand", from: "Polo RL", to: "Polo Ralph Lauren", count: 1 }])).toEqual([]);
    expect(activeRules([{ field: "brand", from: "Polo RL", to: "Polo Ralph Lauren", count: 2 }])).toHaveLength(1);
    expect(activeRules([
      { field: "brand", from: "polo rl", to: "A", count: 2 },
      { field: "brand", from: "Polo RL", to: "B", count: 2 },
    ])).toEqual([]);
    expect(activeRules([
      { field: "brand", from: "Polo RL", to: "A", count: 3 },
      { field: "brand", from: "Polo RL", to: "B", count: 2 },
    ])).toEqual([{ field: "brand", from: "Polo RL", to: "A" }]);
  });
  it("never learns non-learnable fields", () => {
    expect(activeRules([{ field: "size" as never, from: "L", to: "XL", count: 9 }])).toEqual([]);
  });
});

describe("applyLearnedFixes", () => {
  const rules = [{ field: "brand" as const, from: "Polo RL", to: "Polo Ralph Lauren" }, { field: "color" as const, from: "Navy", to: "Blue" }];
  it("fixes fields, specifics and the brand in the title", () => {
    const r = applyLearnedFixes({ brand: "polo rl", color: "Navy", size: "L", suggestedTitle: "Polo RL Mens Polo Shirt L", itemSpecifics: { Brand: ["Polo RL"], Color: ["Navy"], Size: ["L"] } }, rules);
    expect(r.brand).toBe("Polo Ralph Lauren");
    expect(r.color).toBe("Blue");
    expect(r.size).toBe("L");
    expect(r.itemSpecifics).toEqual({ Brand: ["Polo Ralph Lauren"], Color: ["Blue"], Size: ["L"] });
    expect(r.suggestedTitle).toBe("Polo Ralph Lauren Mens Polo Shirt L");
    expect(r.learnedFixes).toHaveLength(2);
  });
  it("doesn't touch partial-word matches or titles that would exceed 80", () => {
    const r = applyLearnedFixes({ brand: "Gap", suggestedTitle: "Gapstar tee" }, [{ field: "brand", from: "Gap", to: "GAP Inc" }]);
    expect(r.suggestedTitle).toBe("Gapstar tee");
    const long = "Polo RL " + "x".repeat(70);
    expect(applyLearnedFixes({ brand: "Polo RL", suggestedTitle: long }, rules).suggestedTitle).toBe(long);
  });
  it("no rules = same object; unmatched = no learnedFixes", () => {
    const x = { brand: "Nike" };
    expect(applyLearnedFixes(x, [])).toBe(x);
    expect(applyLearnedFixes(x, rules).learnedFixes).toBeUndefined();
  });
});
