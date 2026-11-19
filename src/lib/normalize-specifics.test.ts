import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { normalizeSpecifics } from "./normalize-specifics";
import { mergeAspects, parseAspectDefs, type AspectDef } from "./item-specifics";
import { isLeagueOrTeam } from "./garment";
import AspectPicker from "@/components/AspectPicker";

const d = (name: string, o: { req?: boolean; sel?: boolean; multi?: boolean; values?: string[] } = {}) => ({
  localizedAspectName: name,
  aspectConstraint: { aspectRequired: !!o.req, aspectUsage: o.req ? "REQUIRED" : "RECOMMENDED", aspectMode: o.sel ? "SELECTION_ONLY" : "FREE_TEXT", itemToAspectCardinality: o.multi ? "MULTI" : "SINGLE" },
  aspectValues: (o.values ?? []).map((v) => ({ localizedValue: v })),
});

// Hanes tee in T-Shirts: Season is selection-only, multi, no "All Seasons" value.
const TEE = parseAspectDefs({ aspects: [
  d("Brand", { req: true }), d("Size", { req: true }), d("Season", { sel: true, multi: true, values: ["Fall", "Spring", "Summer", "Winter"] }),
  d("Neckline", { values: ["Crew Neck", "V-Neck", "Round Neck"] }), d("Sleeve Length"),
] });
// Steelers jersey in Football-NFL: no Sleeve Length / Neckline / Features / Type aspects.
const NFL = parseAspectDefs({ aspects: [
  d("Team", { req: true, sel: true, values: ["Pittsburgh Steelers"] }), d("Product", { req: true, sel: true, values: ["NFL Men's Jersey", "T-Shirt"] }),
  d("Brand", { req: false }), d("League", { sel: true, values: ["NFL"] }), d("Size", { req: true }),
] });

describe("Season", () => {
  it("'All Seasons' / 'Year Round' → the four seasons when eBay has no all-season value", () => {
    for (const v of ["All Seasons", "All Season", "Year Round", "all-year"]) {
      expect(normalizeSpecifics({ Season: [v], Brand: ["Hanes"], Size: ["L"] }, TEE, { itemType: "T-Shirt" }).aspects.Season).toEqual(["Spring", "Summer", "Fall", "Winter"]);
    }
  });
  it("uses eBay's own all-season value when the category has one", () => {
    const defs = parseAspectDefs({ aspects: [d("Season", { sel: true, multi: true, values: ["All Seasons", "Fall", "Winter"] })] });
    expect(mergeAspects([{ Season: ["Year Round"] }], defs).aspects.Season).toEqual(["All Seasons"]);
  });
  it("splits combined seasons, and single-value Season takes one", () => {
    expect(normalizeSpecifics({ Season: ["Fall/Winter"] }, TEE, { itemType: "T-Shirt" }).aspects.Season).toEqual(["Fall", "Winter"]);
    expect(normalizeSpecifics({ Season: ["Spring & Summer"] }, TEE, { itemType: "T-Shirt" }).aspects.Season).toEqual(["Spring", "Summer"]);
    expect(normalizeSpecifics({ Season: ["Autumn"] }, TEE, { itemType: "T-Shirt" }).aspects.Season).toEqual(["Fall"]);
    const single = parseAspectDefs({ aspects: [d("Season", { sel: true, values: ["Fall", "Winter"] })] });
    expect(mergeAspects([{ Season: ["Fall/Winter"] }], single).aspects.Season).toEqual(["Fall"]);
  });
});

describe("old Steelers jersey draft is cleaned when opened (and at publish)", () => {
  const old = {
    Brand: ["NFL"], Features: ["Pockets"], Neckline: ["V-Neck", "Round"], "Sleeve Length": ["Long Sleeve"],
    Type: ["Jersey"], Product: ["NFL Men's Jersey"], Team: ["Pittsburgh Steeler"], Size: ["XL"],
  };
  const r = normalizeSpecifics(old, NFL, { title: "Reebok Pittsburgh Steelers Jersey XL", itemType: "Jersey", photoFeatures: [] });
  it("keeps only valid values for this category", () => {
    expect(r.aspects).toEqual({ Product: ["NFL Men's Jersey"], Team: ["Pittsburgh Steelers"], Size: ["XL"] });
    expect(r.changed).toBe(true);
  });
  it("says why things were removed", () => {
    const names = r.removed.map((x) => x.name);
    for (const n of ["Brand", "Features", "Neckline", "Sleeve Length", "Type"]) expect(names).toContain(n);
  });
  it("is idempotent (a second pass changes nothing)", () => {
    expect(normalizeSpecifics(r.aspects, NFL, { title: "Reebok Pittsburgh Steelers Jersey XL", itemType: "Jersey" }).changed).toBe(false);
  });
});

describe("single-value aspects get exactly one value", () => {
  it("'V-Neck, Round' and two-item lists collapse to one valid value", () => {
    expect(normalizeSpecifics({ Neckline: ["V-Neck, Round"] }, TEE, { itemType: "T-Shirt" }).aspects.Neckline).toEqual(["V-Neck"]);
    expect(normalizeSpecifics({ Neckline: ["V-Neck", "Round Neck"] }, TEE, { itemType: "T-Shirt" }).aspects.Neckline).toEqual(["V-Neck"]);
    // free text with no list: comma-separated → first value only
    expect(normalizeSpecifics({ "Sleeve Length": ["Short Sleeve, Cap Sleeve"] }, TEE, { itemType: "T-Shirt" }).aspects["Sleeve Length"]).toEqual(["Short Sleeve"]);
    // but a slash blend in free text stays whole
    const mat = parseAspectDefs({ aspects: [d("Material")] });
    expect(mergeAspects([{ Material: ["Cotton/Polyester"] }], mat).aspects.Material).toEqual(["Cotton/Polyester"]);
    const matListed = parseAspectDefs({ aspects: [d("Material", { values: ["Cotton", "Polyester"] })] });
    expect(mergeAspects([{ Material: ["Cotton/Polyester"] }], matListed).aspects.Material).toEqual(["Cotton/Polyester"]);
  });
});

describe("Brand is never a league or team", () => {
  it.each(["NFL", "nba", "NFL Team Apparel", "Steelers", "Pittsburgh Steelers"])("%s", (b) => {
    expect(isLeagueOrTeam(b, ["Pittsburgh Steelers", "NFL"])).toBe(true);
  });
  it("real makers are kept", () => {
    for (const b of ["Nike", "Reebok", "Mitchell & Ness", "Starter"]) expect(isLeagueOrTeam(b, ["Pittsburgh Steelers", "NFL"])).toBe(false);
    expect(normalizeSpecifics({ Brand: ["Reebok"], Team: ["Pittsburgh Steelers"] }, NFL, { itemType: "Jersey" }).aspects.Brand).toEqual(["Reebok"]);
  });
});

describe("dropdowns never open empty", () => {
  const sleeve: AspectDef = { name: "Sleeve Length", required: false, recommended: true, mode: "FREE_TEXT", multi: false, values: [] };
  it("free text with no eBay values offers curated suggestions; the current value is always listed", () => {
    // closed trigger (SSR) shows the chip; the option list is built from optionsFor + selected
    const html = renderToString(createElement(AspectPicker, { def: sleeve, values: ["Long Sleeve"], onChange: () => {} }));
    expect(html).toContain("Long Sleeve");
  });
});
