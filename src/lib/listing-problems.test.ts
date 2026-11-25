import { describe, it, expect } from "vitest";
import { aspectProblems, parseEbayFieldErrors, problemAspectNames } from "./listing-problems";
import type { AspectDef } from "./item-specifics";

const size: AspectDef = { name: "Size", required: true, recommended: false, mode: "FREE_TEXT", multi: false, values: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "S/M"] };
const color: AspectDef = { name: "Color", required: false, recommended: true, mode: "FREE_TEXT", multi: true, values: ["Beige"] };

describe("parseEbayFieldErrors", () => {
  it("reads the exact production error (Lacoste, Nov 25, 2026)", () => {
    const msg = '"9" is not a valid value for Size. Select a value from the available options. (code 21920468)';
    const p = parseEbayFieldErrors(msg);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ aspect: "Size", kind: "invalid", value: "9" });
    expect(problemAspectNames(p)).toEqual(["size"]);
  });
  it("reads missing item specifics and several errors joined with ·", () => {
    const msg = "The item specific Department is missing. Add Department to this listing, enter a valid value, and then try again. (code 21919303) · \"Purple\" is not a valid value for Color Family. (code 21920468)";
    const p = parseEbayFieldErrors(msg);
    expect(p.map((x) => [x.aspect, x.kind])).toEqual([["Color Family", "invalid"], ["Department", "missing"]]);
  });
  it("nothing field-specific → no fields", () => {
    expect(parseEbayFieldErrors("Invalid shipping policy (code 1)")).toEqual([]);
    expect(parseEbayFieldErrors(null)).toEqual([]);
  });
});

describe("aspectProblems (checked before posting)", () => {
  it("off-list Size is invalid with options; free-text Color is fine", () => {
    const p = aspectProblems({ Size: ["9"], Color: ["Beige", "Orange"] }, [size, color]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ aspect: "Size", kind: "invalid", value: "9" });
    expect(p[0].options.length).toBeGreaterThan(0);
  });
  it("required and empty → missing with eBay's choices", () => {
    const p = aspectProblems({}, [size]);
    expect(p[0]).toMatchObject({ aspect: "Size", kind: "missing" });
    expect(p[0].options).toContain("M");
  });
});
