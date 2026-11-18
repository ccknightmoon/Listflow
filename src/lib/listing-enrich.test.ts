import { describe, it, expect, vi, beforeEach } from "vitest";

const { ai, cat, defs } = vi.hoisted(() => ({ ai: vi.fn(), cat: vi.fn(), defs: vi.fn() }));
vi.mock("@/lib/openai-request", () => ({ openAIPost: (...a: unknown[]) => ai(...a) }));
vi.mock("@/lib/ebay-category", () => ({ chooseCategory: (...a: unknown[]) => cat(...a) }));
vi.mock("@/lib/ebay-aspects", () => ({ fetchAspectDefs: (...a: unknown[]) => defs(...a), defsForClient: (d: unknown) => d }));

import { enrichListing, enrichVisionResult, chooseTitle, visionMeasurements, brandFirst } from "./listing-enrich";
import { parseAspectDefs } from "./item-specifics";

// A trimmed Men's Coats & Jackets aspect list.
const JACKET_DEFS = parseAspectDefs({
  aspects: [
    { localizedAspectName: "Brand", aspectConstraint: { aspectRequired: true, aspectMode: "FREE_TEXT" } },
    { localizedAspectName: "Size", aspectConstraint: { aspectRequired: true, aspectMode: "FREE_TEXT" } },
    { localizedAspectName: "Department", aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY" }, aspectValues: [{ localizedValue: "Men" }, { localizedValue: "Women" }] },
    { localizedAspectName: "Type", aspectConstraint: { aspectRequired: true, aspectMode: "FREE_TEXT" }, aspectValues: [{ localizedValue: "Jacket" }, { localizedValue: "Coat" }] },
    { localizedAspectName: "Outer Shell Material", aspectConstraint: { aspectUsage: "RECOMMENDED", aspectMode: "FREE_TEXT", itemToAspectCardinality: "MULTI" }, aspectValues: [{ localizedValue: "Cotton Canvas" }] },
    { localizedAspectName: "Closure", aspectConstraint: { aspectUsage: "RECOMMENDED", aspectMode: "FREE_TEXT" }, aspectValues: [{ localizedValue: "Zip" }, { localizedValue: "Button" }] },
    { localizedAspectName: "Lining Material", aspectConstraint: { aspectUsage: "RECOMMENDED", aspectMode: "FREE_TEXT" } },
    { localizedAspectName: "Country/Region of Manufacture", aspectConstraint: { aspectUsage: "RECOMMENDED", aspectMode: "SELECTION_ONLY" }, aspectValues: [{ localizedValue: "United States" }, { localizedValue: "Mexico" }] },
    { localizedAspectName: "Color", aspectConstraint: { aspectUsage: "RECOMMENDED", aspectMode: "FREE_TEXT", itemToAspectCardinality: "MULTI" }, aspectValues: [{ localizedValue: "Brown" }] },
  ],
});

const CARHARTT = {
  itemType: "Jacket", department: "Men", brand: "Carhartt", color: "Brown", size: "XL", condition: "Good - minor flaws",
  flaws: "fraying at both cuffs; small paint mark on back", vintage: "Yes", era: "90s", material: "Cotton Canvas",
  tagText: "Carhartt J97 BRN XL Made in USA 100% Cotton", measurements: { pitToPit: "26", length: "28 approx", sleeve: "" },
  specifics: { Closure: "Zip", "Lining Material": "Blanket", "Product Line": "Detroit Jacket", Model: "J97", "Country/Region of Manufacture": "United States" },
  suggestedTitle: "Vintage 90s Carhartt Detroit Jacket J97 Blanket Lined Duck Canvas Brown Mens XL Made in USA",
};

beforeEach(() => {
  ai.mockReset(); cat.mockReset(); defs.mockReset();
  cat.mockResolvedValue({ categoryId: "57988", categoryPath: "Clothing, Shoes & Accessories > Men > Men's Clothing > Coats, Jackets & Vests", needsReview: false, query: "q", rejected: [], kind: "outerwear" });
  defs.mockResolvedValue(JACKET_DEFS);
});

describe("enrichListing", () => {
  it("fills the category's aspects from photo facts, snaps values, and fits the title", async () => {
    ai.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ aspects: [] }) } }] });
    const r = await enrichListing("k", CARHARTT);
    expect(r.categoryId).toBe("57988");
    expect(r.itemSpecifics).toMatchObject({
      Brand: ["Carhartt"], Size: ["XL"], Department: ["Men"], Type: ["Jacket"], Color: ["Brown"],
      Closure: ["Zip"], "Lining Material": ["Blanket"], "Country/Region of Manufacture": ["United States"],
    });
    // Only this category's own aspects are kept (so every value is one eBay knows here).
    for (const k of ["Product Line", "Model", "Vintage"]) expect(r.itemSpecifics[k]).toBeUndefined();
    expect(r.missingRequired).toEqual([]);
    expect(r.suggestedTitle.length).toBeLessThanOrEqual(80);
    expect(r.measurementsList).toEqual([{ key: "pitToPit", inches: 26, approx: false }, { key: "length", inches: 28, approx: true }]);
    // Everything required was already known from the photos, so only
    // recommended aspects that are still empty were sent to the text model.
    const prompt = JSON.stringify(ai.mock.calls[0]?.[1] ?? {});
    expect(prompt).toContain("Outer Shell Material");
    expect(prompt).not.toContain('\\"name\\":\\"Brand\\"');
  });

  it("uses the text model's answer only for aspects the photos didn't fill, and never lets it override them", async () => {
    ai.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ aspects: [{ name: "Outer Shell Material", values: ["cotton canvas"] }, { name: "Brand", values: ["Dickies"] }] }) } }] });
    const r = await enrichListing("k", CARHARTT);
    expect(r.itemSpecifics["Outer Shell Material"]).toEqual(["Cotton Canvas"]);
    expect(r.itemSpecifics.Brand).toEqual(["Carhartt"]);
  });

  it("flags required aspects nobody could fill (never invents them)", async () => {
    ai.mockResolvedValue({ choices: [{ message: { content: "{}" } }] });
    const r = await enrichListing("k", { ...CARHARTT, size: "", brand: "" });
    expect(r.missingRequired).toEqual(["Brand", "Size"]);
    expect(r.itemSpecifics.Brand).toBeUndefined();
  });

  it("survives a failing text model", async () => {
    ai.mockRejectedValue(new Error("rate limited"));
    const r = await enrichListing("k", CARHARTT);
    expect(r.itemSpecifics.Brand).toEqual(["Carhartt"]);
  });
});

describe("enrichVisionResult", () => {
  it("without an eBay connection returns the vision fields with flattened measurements", async () => {
    const r = await enrichVisionResult("k", CARHARTT, null);
    expect(r.pitToPit).toBe("26");
    expect(r.measurementLines).toEqual(['Pit to pit: 26"', 'Length: 28" (approx.)']);
    expect(r.itemSpecifics).toBeUndefined();
  });
  it("falls back cleanly when enrichment throws", async () => {
    const r = await enrichVisionResult("k", CARHARTT, async () => { throw new Error("eBay down"); });
    expect(r.brand).toBe("Carhartt");
    expect((r.suggestedTitle ?? "").length).toBeLessThanOrEqual(80);
  });
});

describe("helpers", () => {
  it("reads old top-level and new nested measurements", () => {
    expect(visionMeasurements({ pitToPit: "20", waist: "approx 32" })).toEqual([{ key: "pitToPit", inches: 20, approx: false }, { key: "waist", inches: 32, approx: true }]);
  });
  it("moves the brand to the front of the AI's title", () => {
    expect(brandFirst("Vintage 90s Carhartt Detroit Jacket J97 Men's XL Brown", "Carhartt")).toBe("Carhartt Vintage 90s Detroit Jacket J97 Men's XL Brown");
    expect(brandFirst("Carhartt Jacket", "Carhartt")).toBe("Carhartt Jacket");
    expect(brandFirst("Vintage Jacket", "Unbranded")).toBe("Vintage Jacket");
  });
  it("composes a title when the AI's is missing or too short", () => {
    const t = chooseTitle({ suggestedTitle: "Jersey", itemType: "Jersey" }, { Brand: ["Mitchell & Ness"], Department: ["Men"], Team: ["Dallas Cowboys"], Player: ["Michael Irvin"], Size: ["52"], Color: ["Blue"], Vintage: ["Yes"] });
    expect(t).toBe("Mitchell & Ness Vintage Men's Jersey Dallas Cowboys Michael Irvin Size 52 Blue");
  });
});
