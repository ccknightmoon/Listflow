import { describe, it, expect } from "vitest";
import { matchAllowedValue, cleanAspectInput, isRejectedValue, suggestAllowedValues, mergeAspects, type AspectDef } from "./item-specifics";
import { defsForClient } from "./ebay-aspects";

// eBay's Country/Region of Manufacture is a long selection-only list.
const COUNTRIES = ["Afghanistan", "Bangladesh", "Cambodia", "Canada", "China", "Hong Kong", "India", "Indonesia", "Korea, South", "Mexico", "Pakistan", "Taiwan", "Turkey", "United Kingdom", "United States", "Unknown", "Vietnam"];
const country: AspectDef = { name: "Country/Region of Manufacture", required: false, recommended: true, mode: "SELECTION_ONLY", multi: false, values: COUNTRIES };

describe("country of manufacture", () => {
  it.each([
    ["United States", "United States"], ["united states", "United States"], ["USA", "United States"], ["U.S.A.", "United States"],
    ["US", "United States"], ["America", "United States"], ["United States of America", "United States"], ["Made in USA", "United States"],
    ["Made in the U.S.A.", "United States"], ["Country of origin: China", "China"], ["made in china.", "China"],
    ["UK", "United Kingdom"], ["England", "United Kingdom"], ["Viet Nam", "Vietnam"], ["Türkiye".normalize("NFD").replace(/[̀-ͯ]/g, ""), "Turkey"],
  ])("%s → %s", (input, expected) => {
    expect(matchAllowedValue(input, country)).toBe(expected);
    expect(isRejectedValue(input, country)).toBe(false);
  });
  it("a real problem is flagged with one-tap suggestions", () => {
    expect(isRejectedValue("Atlantis", country)).toBe(true);
    expect(suggestAllowedValues("Untied States", country)[0]).toBe("United States");
  });
  it("cleans tag noise", () => {
    expect(cleanAspectInput("Made in Mexico.")).toBe("Mexico");
    expect(cleanAspectInput("Assembled in the USA")).toBe("USA");
  });
});

describe("free-text aspects are never flagged", () => {
  const brand: AspectDef = { name: "Brand", required: true, recommended: false, mode: "FREE_TEXT", multi: false, values: ["Nike", "Adidas"] };
  it("any value is fine, known values snap to eBay's spelling", () => {
    expect(isRejectedValue("Some Tiny Label", brand)).toBe(false);
    expect(matchAllowedValue("nike", brand)).toBe("Nike");
    expect(matchAllowedValue("Some Tiny Label", brand)).toBe("Some Tiny Label");
  });
  it("free-text country without a list gets the canonical spelling", () => {
    expect(matchAllowedValue("Made in USA", { mode: "FREE_TEXT", values: [] })).toBe("United States");
  });
  it("casing differences are fixed across any value list", () => {
    const color: AspectDef = { name: "Color", required: false, recommended: true, mode: "SELECTION_ONLY", multi: true, values: ["Navy", "Blue", "Multicolor"] };
    expect(mergeAspects([{ Color: ["NAVY", "multicolor"] }], [color]).aspects.Color).toEqual(["Navy", "Multicolor"]);
  });
});

describe("browser copy of eBay's lists", () => {
  it("sends selection-only lists whole (United States is past value #120)", () => {
    const long: AspectDef = { ...country, values: [...Array.from({ length: 230 }, (_, i) => `Country ${i}`), "United States"] };
    const [d] = defsForClient([long]);
    expect(d.values).toContain("United States");
    expect(d.valuesTruncated).toBeUndefined();
    expect(isRejectedValue("United States", d)).toBe(false);
  });
  it("trims long free-text lists and marks them, so nothing is wrongly flagged", () => {
    const brand: AspectDef = { name: "Brand", required: true, recommended: false, mode: "FREE_TEXT", multi: false, values: Array.from({ length: 3000 }, (_, i) => `B${i}`) };
    const [d] = defsForClient([brand]);
    expect(d.values).toHaveLength(120);
    expect(d.valuesTruncated).toBe(true);
    expect(isRejectedValue("Zzz Brand", { ...d, mode: "SELECTION_ONLY" })).toBe(false); // truncated → never flagged
  });
});
