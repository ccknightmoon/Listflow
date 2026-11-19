import { describe, it, expect, vi, beforeEach } from "vitest";
import { passBAnswer } from "@/test/pass-b";
import { matchAllowedValue, mergeAspects, editDistance, capLength, parseAspectDefs, type AspectDef } from "./item-specifics";
import { sanitizeForItem, dedupeAspects } from "./garment";

const NFL_TEAMS = ["Arizona Cardinals", "Pittsburgh Steelers", "Philadelphia Eagles", "Dallas Cowboys", "New York Giants", "New York Jets"];
const team: AspectDef = { name: "Team", required: true, recommended: false, mode: "SELECTION_ONLY", multi: false, values: NFL_TEAMS };

describe("every AI value must be an eBay value", () => {
  it("fuzzy-matches singular/plural, case, punctuation and typos to eBay's exact value", () => {
    expect(matchAllowedValue("Pittsburgh Steeler", team)).toBe("Pittsburgh Steelers");
    expect(matchAllowedValue("pittsburgh steelers", team)).toBe("Pittsburgh Steelers");
    expect(matchAllowedValue("Philidelphia Eagles", team)).toBe("Philadelphia Eagles");
    expect(matchAllowedValue("Dallas Cowboys.", team)).toBe("Dallas Cowboys");
  });
  it("selection-only with no real match → blank (dropped, and reported)", () => {
    expect(matchAllowedValue("Pittsburgh Pirates", team)).toBeNull();
    expect(matchAllowedValue("Giants", team)).toBeNull(); // ambiguous isn't guessed
    const r = mergeAspects([{ Team: ["Gotham Rogues"] }], [team]);
    expect(r.aspects.Team).toBeUndefined();
    expect(r.dropped).toEqual([{ name: "Team", value: "Gotham Rogues" }]);
    expect(r.missingRequired).toEqual(["Team"]);
  });
  it("a tie between two equally close values isn't guessed", () => {
    expect(matchAllowedValue("New York Gints", { mode: "SELECTION_ONLY", values: ["New York Giants", "New York Gents"] })).toBeNull();
  });
  it("USA → United States", () => {
    expect(matchAllowedValue("USA", { mode: "SELECTION_ONLY", values: ["Mexico", "United States"] })).toBe("United States");
  });
  it("free text with recommended values only snaps when near-identical, otherwise keeps the text", () => {
    const brand: AspectDef = { name: "Brand", required: true, recommended: false, mode: "FREE_TEXT", multi: false, values: ["Nike", "Hanes", "Champion"] };
    expect(matchAllowedValue("hanes", brand)).toBe("Hanes");
    expect(matchAllowedValue("Hane", brand)).toBe("Hanes"); // 1 edit
    expect(matchAllowedValue("Hanes Beefy-T", brand)).toBe("Hanes Beefy-T"); // kept
    expect(matchAllowedValue("Mike", brand)).toBe("Mike"); // short words are never fuzzed (Mike ≠ Nike)
  });
  it("respects cardinality and max length", () => {
    const single: AspectDef = { name: "Sport", required: false, recommended: true, mode: "SELECTION_ONLY", multi: false, values: ["Football", "Baseball"] };
    const multi: AspectDef = { name: "Theme", required: false, recommended: true, mode: "FREE_TEXT", multi: true, values: ["Sports", "Retro"] };
    expect(mergeAspects([{ Sport: ["Football", "Baseball"] }], [single]).aspects.Sport).toEqual(["Football"]);
    expect(mergeAspects([{ Theme: ["sports", "retro", "sports"] }], [multi]).aspects.Theme).toEqual(["Sports", "Retro"]);
    const long = "A".repeat(10) + " " + "very long free text value that keeps going past the sixty five character limit";
    expect(capLength(long).length).toBeLessThanOrEqual(65);
    expect(mergeAspects([{ Notes: [long] }], []).aspects.Notes[0].length).toBeLessThanOrEqual(65);
  });
  it("edit distance basics", () => {
    expect(editDistance("steeler", "steelers")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("abc", "abcdefgh", 2)).toBe(3); // bails out past the limit
  });
});

describe("jersey: no pockets, no duplicate Type", () => {
  it("drops 'Pockets' on a jersey unless the photos showed pockets", () => {
    expect(sanitizeForItem({ Features: ["Pockets", "Embroidered Logo"] }, "sports-jersey", { photoFeatures: [] }).aspects.Features).toEqual(["Embroidered Logo"]);
    expect(sanitizeForItem({ Features: ["Pockets"] }, "sports-jersey", { photoFeatures: ["Pockets"] }).aspects.Features).toEqual(["Pockets"]);
    expect(sanitizeForItem({ Features: ["Pockets"] }, "bottom", { photoFeatures: [] }).aspects.Features).toEqual(["Pockets"]);
  });
  it("drops an extra Type that repeats the category's Product", () => {
    expect(dedupeAspects({ Product: ["Jersey"], Type: ["Jersey"], Team: ["Pittsburgh Steelers"] }, ["Product", "Team"])).toEqual({ Product: ["Jersey"], Team: ["Pittsburgh Steelers"] });
    expect(dedupeAspects({ Product: ["Jersey"], Type: ["Jersey"] }, ["Product", "Type"])).toEqual({ Product: ["Jersey"], Type: ["Jersey"] }); // both real aspects: kept
  });
});

// End to end through the analyze step: the Steelers jersey from Sel's screenshot.
const { ai, cat, defs } = vi.hoisted(() => ({ ai: vi.fn(), cat: vi.fn(), defs: vi.fn() }));
vi.mock("@/lib/openai-request", () => ({ openAIPost: (...a: unknown[]) => ai(...a) }));
vi.mock("@/lib/ebay-category", () => ({ chooseCategory: (...a: unknown[]) => cat(...a) }));
vi.mock("@/lib/ebay-aspects", () => ({ fetchAspectDefs: (...a: unknown[]) => defs(...a), defsForClient: (d: unknown) => d }));
import { enrichListing } from "./listing-enrich";

describe("Steelers jersey end to end", () => {
  beforeEach(() => {
    cat.mockResolvedValue({ categoryId: "24511", categoryPath: "Sports Mem, Cards & Fan Shop > Fan Apparel & Souvenirs > Football-NFL", needsReview: false, query: "q", rejected: [], kind: "sports-jersey" });
    defs.mockResolvedValue(parseAspectDefs({ aspects: [
      { localizedAspectName: "Team", aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY" }, aspectValues: NFL_TEAMS.map((v) => ({ localizedValue: v })) },
      { localizedAspectName: "Product", aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY" }, aspectValues: [{ localizedValue: "Jersey" }, { localizedValue: "T-Shirt" }] },
      { localizedAspectName: "League", aspectConstraint: { aspectUsage: "RECOMMENDED", aspectMode: "SELECTION_ONLY" }, aspectValues: [{ localizedValue: "NFL" }] },
      { localizedAspectName: "Features", aspectConstraint: { aspectUsage: "RECOMMENDED", aspectMode: "FREE_TEXT", itemToAspectCardinality: "MULTI" }, aspectValues: [{ localizedValue: "Pockets" }, { localizedValue: "Embroidered" }] },
      { localizedAspectName: "Size", aspectConstraint: { aspectRequired: true, aspectMode: "FREE_TEXT" } },
    ] }));
    // The text model "helpfully" adds Product and invents pockets.
    ai.mockImplementation(async (_k: string, body: unknown) => passBAnswer(body, { Product: "Jersey", Features: ["Pockets"] }));
  });
  it("Team snaps to 'Pittsburgh Steelers', no Pockets, no duplicate Type", async () => {
    const r = await enrichListing("k", {
      itemType: "Jersey", brand: "Reebok", size: "XL", color: "Black",
      specifics: { Team: "Pittsburgh Steeler", League: "NFL" },
      suggestedTitle: "Reebok Pittsburgh Steelers Jersey Men's XL Black NFL",
    });
    expect(r.itemSpecifics.Team).toEqual(["Pittsburgh Steelers"]);
    expect(r.itemSpecifics.Product).toEqual(["Jersey"]);
    expect(r.itemSpecifics.Type).toBeUndefined();
    expect(r.itemSpecifics.Features).toBeUndefined();
    expect(r.missingRequired).toEqual([]);
  });
  it("a team that matches nothing is left blank and flagged", async () => {
    const r = await enrichListing("k", { itemType: "Jersey", size: "XL", specifics: { Team: "Gotham Rogues" }, suggestedTitle: "Gotham Rogues Jersey XL football" });
    expect(r.itemSpecifics.Team).toBeUndefined();
    expect(r.missingRequired).toContain("Team");
    expect(r.issues.join(" ")).toMatch(/Team: "Gotham Rogues" isn't one of eBay's values/);
  });
});
