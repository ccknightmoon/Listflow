// Nov 25, 2026: a Lacoste polo tagged "9" was sent to eBay as Size "9" and
// rejected (code 21920468). eBay's metadata calls Size FREE_TEXT, but the
// listing API only accepts values from its list.
import { describe, it, expect } from "vitest";
import { effectiveMode, mapTagSize, strictDefs } from "./size-mapping";
import { isRejectedValue, mergeAspects, type AspectDef } from "./item-specifics";
import { buildPublishAspects } from "./publish-aspects";

// Real shape of eBay's Size aspect for Men's Polos (185101), as cached in
// ebay_metadata_cache on Nov 25, 2026: FREE_TEXT, required, 84 values.
const SIZES = ["2XS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL", "8XL", "S/M", "M/L", "L/XL", "XL/2XL", "2XL/3XL", "3XL/4XL", "XS/S",
  "28", "30", "32", "34", "36", "38", "40", "42", "44", "46", "48", "50", "52", "54", "56", "58", "60", "62", "Big 1X", "Big 2X"];
const size: AspectDef = { name: "Size", required: true, recommended: false, mode: "FREE_TEXT", multi: false, values: SIZES };
const brand: AspectDef = { name: "Brand", required: true, recommended: false, mode: "FREE_TEXT", multi: false, values: ["Lacoste", "Nike"] };
const dept: AspectDef = { name: "Department", required: true, recommended: false, mode: "SELECTION_ONLY", multi: false, values: ["Men", "Unisex Adults"] };
const type: AspectDef = { name: "Type", required: false, recommended: true, mode: "FREE_TEXT", multi: false, values: ["Polo"] };
const defs = [dept, size, brand, type];

describe("eBay's Size list is enforced even though its metadata says FREE_TEXT", () => {
  it("treats a clothing Size list as selection-only", () => {
    expect(effectiveMode(size)).toBe("SELECTION_ONLY");
    expect(strictDefs([size])[0].mode).toBe("SELECTION_ONLY");
    // Short/empty lists and other free-text aspects are untouched.
    expect(effectiveMode({ name: "Size", mode: "FREE_TEXT", values: [] })).toBe("FREE_TEXT");
    expect(effectiveMode(brand)).toBe("FREE_TEXT");
  });
  it('flags "9" as a value eBay rejects', () => {
    expect(isRejectedValue("9", size)).toBe(true);
    expect(isRejectedValue("XL", size)).toBe(false);
  });
});

describe("mapTagSize", () => {
  it("Lacoste numeric sizes → US letter sizes (2=XS … 9=4XL, 10=5XL)", () => {
    const want: Record<string, string> = { "1": "2XS", "2": "XS", "3": "S", "4": "M", "5": "L", "6": "XL", "7": "2XL", "8": "3XL", "9": "4XL", "10": "5XL" };
    for (const [tag, letter] of Object.entries(want)) {
      expect(mapTagSize(tag, SIZES, { brand: "Lacoste" })?.value).toBe(letter);
    }
    expect(mapTagSize("9", SIZES, { brand: "Lacoste" })?.note).toBe("Lacoste size 9 = 4XL");
    expect(mapTagSize("Size 9", SIZES, { brand: "LACOSTE" })?.value).toBe("4XL");
    expect(mapTagSize("T5", SIZES, { brand: "Lacoste" })?.value).toBe("L");
  });
  it("a bare number with no known brand chart is NOT guessed", () => {
    expect(mapTagSize("9", SIZES, { brand: "Nike" })).toBeNull();
    expect(mapTagSize("9", SIZES)).toBeNull();
  });
  it("letter spellings → eBay's spelling", () => {
    expect(mapTagSize("XXL", SIZES)?.value).toBe("2XL");
    expect(mapTagSize("xxxl", SIZES)?.value).toBe("3XL");
    expect(mapTagSize("Large", SIZES)?.value).toBe("L");
    expect(mapTagSize("X-Large", SIZES)?.value).toBe("XL");
    expect(mapTagSize("SMALL 36-38", SIZES)?.value).toBe("S");
    expect(mapTagSize("Medium (38-40)", SIZES)?.value).toBe("M");
    expect(mapTagSize("L/G", SIZES)?.value).toBe("L");
    expect(mapTagSize("XL/TG", SIZES)?.value).toBe("XL");
    // A real eBay combined size stays as it is.
    expect(mapTagSize("S/M", SIZES)?.value).toBe("S/M");
    // Lists that spell it XXL get XXL.
    expect(mapTagSize("2XL", ["S", "M", "L", "XL", "XXL"])?.value).toBe("XXL");
  });
  it("Italian/EU sizes only when the tag says so; collar sizes", () => {
    expect(mapTagSize("IT 50", SIZES)?.value).toBe("L");
    expect(mapTagSize("EU 48", SIZES)?.value).toBe("M");
    expect(mapTagSize("50", SIZES)?.value).toBe("50"); // bare 50 is a valid chest size on eBay
    expect(mapTagSize("15.5", SIZES)?.value).toBe("M");
    expect(mapTagSize("16 1/2", SIZES)?.value).toBe("L");
    expect(mapTagSize("17-17.5", SIZES)?.value).toBe("XL");
  });
});

describe("mergeAspects / publish never send an off-list Size", () => {
  it("Lacoste '9' becomes 4XL using the Brand in the same specifics", () => {
    const r = mergeAspects([{ Size: ["9"], Brand: ["Lacoste"], Department: ["Men"] }], defs);
    expect(r.aspects.Size).toEqual(["4XL"]);
    expect(r.missingRequired).toEqual([]);
    expect(r.sizeNote).toBe("Lacoste size 9 = 4XL");
  });
  it("an unmappable size is left blank and reported missing (needs your pick), never kept raw", () => {
    const r = mergeAspects([{ Size: ["9"], Brand: ["Nike"], Department: ["Men"] }], defs);
    expect(r.aspects.Size).toBeUndefined();
    expect(r.dropped).toEqual([{ name: "Size", value: "9" }]);
    expect(r.missingRequired).toEqual(["Size"]);
  });
  it("the exact Lacoste draft from production publishes Size 4XL", () => {
    const draft = {
      title: "Vtg Lacoste Men's stripe Polo Shirt Size 9 Beige", brand: "Lacoste", size: "9", item_type: "Polo", color: "Beige",
      item_specifics: { aspects: { Size: ["9"], Type: ["Polo"], Brand: ["Lacoste"], Department: ["Men"] }, categoryId: "185101" },
    };
    const p = buildPublishAspects(draft, defs);
    expect(p.aspects.Size).toEqual(["4XL"]);
    expect(p.rejected).toEqual([]);
    expect(p.sizeNote).toBe("Lacoste size 9 = 4XL");
  });
  it("a non-Lacoste numeric size is reported as rejected (publish refuses before eBay)", () => {
    const draft = { title: "Polo Shirt Size 9", brand: "Nike", size: "9", item_type: "Polo", item_specifics: { aspects: { Size: ["9"], Department: ["Men"] } } };
    const p = buildPublishAspects(draft, defs);
    expect(p.aspects.Size).toBeUndefined();
    expect(p.rejected).toEqual([{ name: "Size", value: "9", options: SIZES.slice(0, 12) }]);
  });
});
