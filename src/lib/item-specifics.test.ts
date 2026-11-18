import { describe, it, expect } from "vitest";
import {
  parseAspectDefs, matchAllowedValue, mergeAspects, missingRequiredAspects, aspectsFromDraft, parseMeasurement, measurementsFrom,
  measurementLines, measurementAspects, pickCondition, conditionNote, fitTitle, composeTitle, buildDescriptionHtml, aspectsToAsk,
  parseAiAspects, TITLE_MAX, type AspectDef,
} from "./item-specifics";

const def = (name: string, o: Partial<AspectDef> = {}): AspectDef => ({ name, required: false, recommended: true, mode: "FREE_TEXT", multi: false, values: [], ...o });

// Shape of eBay's getItemAspectsForCategory for a men's coats & jackets leaf (trimmed).
const RAW = {
  aspects: [
    { localizedAspectName: "Color", aspectConstraint: { aspectUsage: "RECOMMENDED", aspectMode: "FREE_TEXT", itemToAspectCardinality: "MULTI" }, aspectValues: [{ localizedValue: "Brown" }, { localizedValue: "Gray" }, { localizedValue: "Beige" }] },
    { localizedAspectName: "Brand", aspectConstraint: { aspectRequired: true, aspectUsage: "RECOMMENDED", aspectMode: "FREE_TEXT", itemToAspectCardinality: "SINGLE" }, aspectValues: [{ localizedValue: "Carhartt" }] },
    { localizedAspectName: "Department", aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY", itemToAspectCardinality: "SINGLE" }, aspectValues: [{ localizedValue: "Men" }, { localizedValue: "Women" }, { localizedValue: "Unisex Adult" }] },
    { localizedAspectName: "Outer Shell Material", aspectConstraint: { aspectUsage: "RECOMMENDED", aspectMode: "FREE_TEXT", itemToAspectCardinality: "MULTI" }, aspectValues: [{ localizedValue: "Cotton Canvas" }, { localizedValue: "Cotton" }, { localizedValue: "Nylon" }] },
    { localizedAspectName: "Closure", aspectConstraint: { aspectUsage: "OPTIONAL", aspectMode: "FREE_TEXT", itemToAspectCardinality: "SINGLE" }, aspectValues: [{ localizedValue: "Zip" }, { localizedValue: "Button" }] },
    { localizedAspectName: "Size", aspectConstraint: { aspectRequired: true, aspectMode: "FREE_TEXT", itemToAspectCardinality: "SINGLE" }, aspectValues: [{ localizedValue: "L" }, { localizedValue: "XL" }] },
  ],
};

describe("eBay aspect definitions", () => {
  it("parses required / recommended / allowed values, required first", () => {
    const defs = parseAspectDefs(RAW);
    expect(defs.map((d) => d.name)).toEqual(["Brand", "Department", "Size", "Color", "Outer Shell Material", "Closure"]);
    expect(defs[1]).toMatchObject({ required: true, mode: "SELECTION_ONLY", values: ["Men", "Women", "Unisex Adult"] });
    expect(defs.find((d) => d.name === "Color")).toMatchObject({ recommended: true, multi: true });
    expect(parseAspectDefs(null)).toEqual([]);
  });
});

describe("allowed-value matching", () => {
  const color = def("Color", { values: ["Gray", "Light Blue", "Blue", "Multicolor"] });
  const dept = def("Department", { mode: "SELECTION_ONLY", values: ["Men", "Women", "Unisex Adult"] });
  it("snaps case, spelling variants and synonyms to eBay's value", () => {
    expect(matchAllowedValue("grey", color)).toBe("Gray");
    expect(matchAllowedValue("light blue", color)).toBe("Light Blue");
    expect(matchAllowedValue("Light blue denim", color)).toBe("Light Blue"); // longest whole-word hit
    expect(matchAllowedValue("Men's", dept)).toBe("Men");
  });
  it("selection-only never guesses; free text keeps the seller's value", () => {
    expect(matchAllowedValue("Kids", dept)).toBeNull();
    expect(matchAllowedValue("Burnt Orange", color)).toBe("Burnt Orange");
    expect(matchAllowedValue("   ", color)).toBeNull();
  });
});

describe("merging aspects", () => {
  const defs = parseAspectDefs(RAW);
  it("later sources win, values snap to eBay's lists, unknowns are dropped, missing required flagged", () => {
    const r = mergeAspects(
      [
        { Brand: ["Carhartt"], Department: ["Men's"], Color: ["brown"] },
        { "Outer Shell Material": ["cotton canvas"], Closure: ["zip"], Department: ["Kids"], Pattern: ["Solid"], Style: ["unknown"] },
      ],
      defs,
    );
    expect(r.aspects).toEqual({ Brand: ["Carhartt"], Color: ["Brown"], "Outer Shell Material": ["Cotton Canvas"], Closure: ["Zip"], Pattern: ["Solid"] });
    expect(r.dropped).toEqual([{ name: "Department", value: "Kids" }]); // Department dropped → required, so:
    expect(r.missingRequired).toEqual(["Department", "Size"]);
  });
  it("seller can clear a value with an empty list", () => {
    const r = mergeAspects([{ Closure: ["Zip"] }, { Closure: [] }], defs);
    expect(r.aspects.Closure).toBeUndefined();
  });
  it("detects required-but-missing directly", () => {
    expect(missingRequiredAspects({ Brand: ["X"], Size: ["L"], Department: [] }, defs)).toEqual(["Department"]);
  });
});

describe("draft fields → aspects", () => {
  it("maps the fixed columns, size type, pants size and decade", () => {
    const a = aspectsFromDraft({ title: "Vintage Levi's 501 Jeans Mens 32x30", brand: "Levi's", size: "32x30", color: "Blue", year_manufactured: "1990-1999", vintage: "Yes", item_type: "Jeans" });
    expect(a).toMatchObject({ Department: ["Men"], Brand: ["Levi's"], Size: ["32x30"], "Size Type": ["Regular"], "Waist Size": ["32 in"], Inseam: ["30 in"], Vintage: ["Yes"], Decade: ["1990s"], Type: ["Jeans"] });
  });
  it("never invents: unknown/empty fields are left out", () => {
    expect(aspectsFromDraft({ title: "Jacket", brand: "unknown", color: "", size: null })).toEqual({});
  });
});

describe("measurements", () => {
  it("parses inches, fractions, cm and approx", () => {
    expect(parseMeasurement("22 inches")).toEqual({ inches: 22, approx: false });
    expect(parseMeasurement("approx 22 1/2\"")).toEqual({ inches: 22.5, approx: true });
    expect(parseMeasurement("~28.3 in")).toEqual({ inches: 28.25, approx: true });
    expect(parseMeasurement("56 cm")).toEqual({ inches: 22, approx: false });
    expect(parseMeasurement("")).toBeNull();
    expect(parseMeasurement("n/a")).toBeNull();
  });
  it("formats lines in a fixed order and maps bottoms to aspects", () => {
    const ms = measurementsFrom({ length: "29", pitToPit: "approx 24", waist: "34", inseam: "30.5", sleeve: "" });
    expect(measurementLines(ms)).toEqual(['Pit to pit: 24" (approx.)', 'Length: 29"', 'Waist: 34"', 'Inseam: 30.5"']);
    const defs = [def("Waist Size"), def("Inseam")];
    expect(measurementAspects(ms, defs)).toEqual({ "Waist Size": ["34 in"], Inseam: ["31 in"] });
    expect(measurementAspects(ms, [])).toEqual({});
  });
});

describe("condition", () => {
  it("picks the category's own enum, never upgrading", () => {
    expect(pickCondition("Excellent used", ["NEW", "PRE_OWNED_EXCELLENT", "USED_EXCELLENT", "PRE_OWNED_FAIR"])).toBe("PRE_OWNED_EXCELLENT");
    expect(pickCondition("Good - minor flaws", ["NEW", "USED_EXCELLENT", "USED_GOOD"])).toBe("USED_EXCELLENT");
    expect(pickCondition("Fair - notable flaws", ["NEW", "USED_GOOD", "USED_ACCEPTABLE"])).toBe("USED_ACCEPTABLE");
    expect(pickCondition("New with tags", ["USED_GOOD"])).toBeNull();
    expect(pickCondition("Excellent used", null)).toBeNull();
  });
  it("writes an honest condition note listing flaws", () => {
    expect(conditionNote("Good - minor flaws", "small stain on left cuff, light fading")).toBe("Pre-owned in good condition with minor wear. Flaws: small stain on left cuff, light fading. Please see all photos.");
    expect(conditionNote("New with tags", "")).toBe("New with tags attached.");
  });
});

describe("title", () => {
  it("fits 80 chars at a word boundary, drops spam and repeated words", () => {
    const t = fitTitle("L@@K Vintage Carhartt Carhartt Detroit Jacket J97 Blanket Lined Duck Canvas Brown Mens Size XL Workwear Chore Coat RARE!!");
    expect(t.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(t).not.toMatch(/L@@K|RARE/i);
    expect(t.match(/Carhartt/g)).toHaveLength(1);
    expect(t.endsWith(" ")).toBe(false);
  });
  it("composes in eBay order and fills the space without exceeding it", () => {
    const t = composeTitle({ brand: "Carhartt", vintage: true, era: "90s", department: "Men", itemType: "Detroit Jacket", details: ["J97", "Blanket Lined", "Duck Canvas", "Workwear", "Chore Coat Extra Long Words Here"], size: "XL", color: "Brown" });
    expect(t).toBe("Carhartt Vintage 90s Men's Detroit Jacket J97 Blanket Lined Size XL Brown");
    expect(t.length).toBeLessThanOrEqual(TITLE_MAX); // details that would pass 80 are skipped
    expect(composeTitle({ brand: "Unbranded", itemType: "T-Shirt", size: "M" })).toBe("T-Shirt Size M");
  });
});

describe("description template", () => {
  const html = buildDescriptionHtml({
    title: "Vintage Carhartt Detroit Jacket",
    summary: "Classic duck canvas work jacket <3",
    details: [["Brand", "Carhartt"], ["Size", "XL"], ["Era", null], ["Material", "Cotton Canvas"]],
    measurements: measurementsFrom({ pitToPit: "26", length: "approx 28" }),
    conditionLabel: "Good - minor flaws",
    flaws: "fraying at cuffs",
    notes: "Ships in 1 business day.\nReturns accepted.",
    sku: "42",
  });
  it("has the fixed sections, escaped text, and skips empty fields", () => {
    expect(html).toMatch(/^<div style="font-family:Arial/);
    expect(html).toContain("<h3 style=\"font-size:16px;margin:16px 0 6px\">Details</h3>");
    expect(html).toContain("<b>Brand:</b> Carhartt");
    expect(html).not.toContain("Era");
    expect(html).toContain("Pit to pit: 26&quot;");
    expect(html).toContain("Length: 28&quot; (approx.)");
    expect(html).toContain("Flaws: fraying at cuffs.");
    expect(html).toContain("Ships in 1 business day.<br>Returns accepted.");
    expect(html).toContain("&lt;3");
    expect(html).not.toMatch(/<script/i);
  });
  it("omits measurements and notes sections when there are none", () => {
    const bare = buildDescriptionHtml({ title: "Tee", details: [], measurements: [], conditionLabel: "Excellent used" });
    expect(bare).not.toContain("Measurements");
    expect(bare).not.toContain("Shipping &amp; returns");
  });
});

describe("AI fill helpers", () => {
  it("asks only for unfilled required/recommended aspects, with short value lists", () => {
    const defs = parseAspectDefs(RAW);
    const ask = aspectsToAsk(defs, { Brand: ["Carhartt"] });
    expect(ask.map((a) => a.name)).toEqual(["Department", "Size", "Color", "Outer Shell Material"]);
    expect(ask[0].allowed).toEqual(["Men", "Women", "Unisex Adult"]);
  });
  it("parses the AI answer, dropping blanks and 'unknown'", () => {
    expect(parseAiAspects({ aspects: [{ name: "Closure", values: ["Zip"] }, { name: "Theme", values: ["unknown"] }, { name: "Features", values: ["Pockets", "pockets", "Hood"] }, { values: ["x"] }] })).toEqual({ Closure: ["Zip"], Features: ["Pockets", "Hood"] });
    expect(parseAiAspects(null)).toEqual({});
  });
});
