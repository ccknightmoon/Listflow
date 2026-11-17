import { describe, it, expect } from "vitest";
import { applyPrice, applyTitle, previewBulkEdit, isValidBulkEdit } from "./bulk-edit";

describe("applyPrice (exact cents)", () => {
  it("set / add / percent", () => {
    expect(applyPrice(20, { mode: "set", value: 24.99 })).toBe(24.99);
    expect(applyPrice(19.99, { mode: "add", value: -2 })).toBe(17.99);
    expect(applyPrice(19.99, { mode: "percent", value: -10 })).toBe(17.99); // 1799.1 -> 1799
    expect(applyPrice(0.1, { mode: "add", value: 0.2 })).toBe(0.99); // min price, and no float drift
    expect(applyPrice(10.05, { mode: "percent", value: 10 })).toBe(11.06);
  });
  it("needs a current price for relative changes", () => {
    expect(applyPrice(null, { mode: "add", value: 5 })).toBeNull();
    expect(applyPrice(null, { mode: "set", value: 5 })).toBe(5);
  });
});

describe("applyTitle", () => {
  it("prepends/appends words with clean spacing", () => {
    expect(applyTitle("Nike Tee  L", { mode: "prepend", text: "Vintage" })).toBe("Vintage Nike Tee L");
    expect(applyTitle("Nike Tee L", { mode: "append", text: " 90s " })).toBe("Nike Tee L 90s");
  });
  it("removes whole words only, any case", () => {
    expect(applyTitle("NWT Nike Tee nwt", { mode: "remove", text: "nwt" })).toBe("Nike Tee");
    expect(applyTitle("Tees Tee", { mode: "remove", text: "Tee" })).toBe("Tees");
  });
  it("replaces phrases", () => {
    expect(applyTitle("Mens Large Tee", { mode: "replace", text: "Mens", with: "Men's" })).toBe("Men's Large Tee");
  });
});

describe("previewBulkEdit", () => {
  const items = [
    { id: "a", title: "Nike Tee L", price: 20, condition: "Excellent used" },
    { id: "b", title: "x".repeat(78), price: null, condition: null },
  ];
  it("preview rows equal the patch that will be saved", () => {
    const rows = previewBulkEdit(items, { price: { mode: "percent", value: 10 }, title: { mode: "append", text: "90s" }, condition: "Good - minor flaws" });
    expect(rows[0].patch).toEqual({ suggested_price: 22, title: "Nike Tee L 90s", condition: "Good - minor flaws" });
    expect(rows[0].after).toEqual({ title: "Nike Tee L 90s", price: 22, condition: "Good - minor flaws" });
  });
  it("never saves a title over 80 characters or a +/- on a missing price", () => {
    const rows = previewBulkEdit(items, { price: { mode: "add", value: 1 }, title: { mode: "append", text: "90s" } });
    expect(rows[1].patch).toEqual({});
    expect(rows[1].warnings.join(" ")).toMatch(/No current price/);
    expect(rows[1].warnings.join(" ")).toMatch(/82 characters/);
  });
});

describe("isValidBulkEdit", () => {
  it("accepts real edits and rejects junk", () => {
    expect(isValidBulkEdit({ price: { mode: "set", value: 9.99 } })).toBe(true);
    expect(isValidBulkEdit({ condition: "Excellent used" })).toBe(true);
    expect(isValidBulkEdit({})).toBe(false);
    expect(isValidBulkEdit({ price: { mode: "set", value: 0.5 } })).toBe(false);
    expect(isValidBulkEdit({ price: { mode: "percent", value: -100 } })).toBe(false);
    expect(isValidBulkEdit({ condition: "Mint" })).toBe(false);
    expect(isValidBulkEdit({ title: { mode: "replace", text: "a" } })).toBe(false);
  });
});
