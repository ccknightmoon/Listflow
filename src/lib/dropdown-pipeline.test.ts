// End-to-end validity: AI fill → normalize → dropdown options → publish
// payload. Every value that reaches a dropdown or eBay must be valid for the
// CURRENT category's eBay metadata.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { ai } = vi.hoisted(() => ({ ai: vi.fn() }));
vi.mock("@/lib/openai-request", () => ({ openAIPost: (...a: unknown[]) => ai(...a) }));

const C = {
  tees: { id: "15687", path: "Clothing, Shoes & Accessories > Men > Men's Clothing > Shirts > T-Shirts" },
  nfl: { id: "24511", path: "Sports Mem, Cards & Fan Shop > Fan Apparel & Souvenirs > Football-NFL" },
  hoodies: { id: "155183", path: "Clothing, Shoes & Accessories > Men > Men's Clothing > Activewear > Hoodies & Sweatshirts" },
  jeans: { id: "11483", path: "Clothing, Shoes & Accessories > Men > Men's Clothing > Jeans" },
  jackets: { id: "57988", path: "Clothing, Shoes & Accessories > Men > Men's Clothing > Coats, Jackets & Vests" },
};
const sugg = (c: { id: string; path: string }) => {
  const parts = c.path.split(" > ");
  return { categorySuggestions: [{ category: { categoryId: c.id, categoryName: parts[parts.length - 1] }, categoryTreeNodeAncestors: parts.slice(0, -1).reverse().map((n, i, arr) => ({ categoryName: n, categoryTreeNodeLevel: arr.length - i })) }] };
};
const d = (name: string, o: { req?: boolean; sel?: boolean; multi?: boolean; values?: string[] } = {}) => ({
  localizedAspectName: name,
  aspectConstraint: { aspectRequired: !!o.req, aspectUsage: o.req ? "REQUIRED" : "RECOMMENDED", aspectMode: o.sel ? "SELECTION_ONLY" : "FREE_TEXT", itemToAspectCardinality: o.multi ? "MULTI" : "SINGLE" },
  aspectValues: (o.values ?? []).map((v) => ({ localizedValue: v })),
});
const COUNTRIES = ["China", "Honduras", "Mexico", "United States", "Vietnam"];
const SEASON = d("Season", { multi: true, values: ["Fall", "Winter", "Spring", "Summer"] });
const COMMON = [
  d("Brand", { req: true }), d("Size", { req: true }), d("Department", { req: true, sel: true, values: ["Men", "Women", "Unisex Adult"] }),
  d("Color", { multi: true, values: ["Black", "Blue", "Gray", "Navy", "Brown", "White"] }),
  d("Country/Region of Manufacture", { sel: true, values: COUNTRIES }), SEASON,
];
const DEFS: Record<string, unknown[]> = {
  [C.tees.id]: [...COMMON, d("Type", { req: true, sel: true, values: ["T-Shirt"] }), d("Sleeve Length"), d("Neckline", { values: ["Crew Neck", "V-Neck"] }), d("Material", { values: ["Cotton", "Polyester"] })],
  [C.nfl.id]: [d("Team", { req: true, sel: true, values: ["Pittsburgh Steelers", "Dallas Cowboys"] }), d("Product", { req: true, sel: true, values: ["Jersey", "T-Shirt"] }), d("League", { sel: true, values: ["NFL"] }), d("Size", { req: true }), d("Brand"), SEASON, d("Country/Region of Manufacture", { sel: true, values: COUNTRIES })],
  [C.hoodies.id]: [...COMMON, d("Type", { req: true, sel: true, values: ["Hoodie", "Sweatshirt"] }), d("Sleeve Length"), d("Closure", { values: ["Pullover", "Zip"] })],
  [C.jeans.id]: [...COMMON, d("Inseam", { req: true }), d("Waist Size", { req: true }), d("Rise", { values: ["Low", "Mid", "High"] }), d("Sleeve Length"), d("Fabric Wash", { values: ["Dark", "Medium", "Light"] })],
  [C.jackets.id]: [...COMMON, d("Type", { req: true, sel: true, values: ["Jacket", "Coat"] }), d("Outer Shell Material", { values: ["Cotton Canvas", "Nylon"] }), d("Closure", { values: ["Zip", "Button"] })],
};

vi.mock("@/lib/ebay-inventory", async (orig) => ({
  ...(await orig<typeof import("@/lib/ebay-inventory")>()),
  inventoryRequest: async (_m: string, path: string) => {
    const q = decodeURIComponent(path.match(/[?&]q=([^&]*)/)?.[1] ?? "").toLowerCase();
    if (path.includes("get_category_suggestions")) {
      const c = /steeler|nfl|jersey/.test(q) ? C.nfl : /hoodie/.test(q) ? C.hoodies : /jeans/.test(q) ? C.jeans : /jacket/.test(q) ? C.jackets : C.tees;
      return { status: 200, data: sugg(c) };
    }
    return { status: 404, data: {} };
  },
}));
// Category metadata straight from the fixture (real parsing + client shaping).
vi.mock("@/lib/ebay-aspects", async (orig) => {
  const real = await orig<typeof import("@/lib/ebay-aspects")>();
  const { parseAspectDefs } = await import("@/lib/item-specifics");
  return { ...real, fetchAspectDefs: async (id: string) => parseAspectDefs({ aspects: DEFS[id] ?? [] }) };
});

import { enrichListing } from "./listing-enrich";
import { defsForClient } from "./ebay-aspects";
import { optionsFor } from "./aspect-fallbacks";
import { buildPublishAspects } from "./publish-aspects";
import { parseAspectDefs, type AspectDef, type Aspects } from "./item-specifics";

// The text model returns sloppy values on purpose.
beforeEach(() => {
  ai.mockReset();
  ai.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ aspects: [
    { name: "Season", values: ["Fall/Winter"] }, { name: "Country/Region of Manufacture", values: ["USA"] },
    { name: "Product", values: ["jersey"] }, { name: "Rise", values: ["mid rise"] }, { name: "Made Up Aspect", values: ["x"] },
  ] }) } }] });
});

function assertValid(aspects: Aspects, defs: AspectDef[], label: string) {
  const byName = new Map(defs.map((x) => [x.name, x]));
  for (const [name, values] of Object.entries(aspects)) {
    const def = byName.get(name);
    expect(def, `${label}: "${name}" isn't one of this category's aspects`).toBeDefined();
    if (def!.mode === "SELECTION_ONLY") for (const v of values) expect(def!.values, `${label}: ${name}="${v}"`).toContain(v);
    if (!def!.multi) expect(values.length, `${label}: ${name} is single-value`).toBe(1);
    for (const v of values) expect(v.length).toBeLessThanOrEqual(65);
  }
}

const ITEMS = [
  { label: "tee", cat: C.tees, v: { itemType: "T-Shirt", department: "Men", brand: "Hanes", size: "L", color: "Black", material: "Cotton", sleeveLength: "Short Sleeve", neckline: "crew neck", season: "Spring/Summer", suggestedTitle: "Hanes T-Shirt Men's L Black", specifics: { "Country/Region of Manufacture": "Made in USA" } } },
  { label: "jersey", cat: C.nfl, v: { itemType: "Jersey", brand: "Reebok", size: "XL", color: "Black", sleeveLength: "Short Sleeve", season: "Fall/Winter", suggestedTitle: "Reebok Pittsburgh Steelers Jersey XL", specifics: { Team: "Pittsburgh Steeler", League: "NFL" } } },
  { label: "hoodie", cat: C.hoodies, v: { itemType: "Hoodie", department: "Men", brand: "Champion", size: "M", color: "Grey", season: "Fall/Winter", suggestedTitle: "Champion Hoodie Men's M Gray", specifics: { Closure: "Pullover" } } },
  { label: "jeans", cat: C.jeans, v: { itemType: "Jeans", department: "Men", brand: "Levi's", size: "32x30", color: "Blue", sleeveLength: "Long Sleeve", suggestedTitle: "Levi's 501 Jeans Men's 32x30 Blue", measurements: { waist: "32", inseam: "30", rise: "10" } } },
  { label: "jacket", cat: C.jackets, v: { itemType: "Jacket", department: "Men", brand: "Carhartt", size: "XL", color: "Brown", season: "Fall & Winter", suggestedTitle: "Carhartt Detroit Jacket Men's XL Brown", specifics: { Closure: "zip", "Country/Region of Manufacture": "U.S.A." } } },
];

describe.each(ITEMS)("$label: AI fill → dropdowns → publish payload", ({ label, cat, v }) => {
  it("every value is valid for the current category's eBay metadata", async () => {
    const r = await enrichListing("k", v);
    expect(r.categoryId).toBe(cat.id);
    const raw = parseAspectDefs({ aspects: DEFS[cat.id] });
    // 1) analysis output
    assertValid(r.itemSpecifics, raw, `${label}/analysis`);
    // 2) dropdown options: selection-only lists are exactly eBay's; curated only for empty free text
    for (const def of defsForClient(r.aspectDefs)) {
      const ebay = raw.find((x) => x.name === def.name)!;
      const opts = optionsFor(def);
      if (ebay.mode === "SELECTION_ONLY") expect(opts.values).toEqual(ebay.values);
      if (opts.curated || def.curated) expect(ebay.mode).toBe("FREE_TEXT");
      if (ebay.values.length) expect(opts.values).toEqual(ebay.values);
    }
    // 3) publish payload from the saved draft
    const pub = buildPublishAspects({ title: v.suggestedTitle, item_type: v.itemType, brand: v.brand, size: v.size, color: v.color, sleeve_length: v.sleeveLength ?? null, season: v.season ?? null,
      item_specifics: { categoryId: cat.id, categoryPath: cat.path, aspects: r.itemSpecifics, measurements: r.measurementsList } }, raw);
    assertValid(pub.aspects, raw, `${label}/publish`);
    expect(pub.missingRequired).toEqual(r.missingRequired);
  });
});

describe("specific expectations", () => {
  it("combined seasons are split into separate eBay values", async () => {
    const r = await enrichListing("k", ITEMS[2].v);
    expect(r.itemSpecifics.Season).toEqual(["Fall", "Winter"]);
    const j = await enrichListing("k", ITEMS[4].v);
    expect(j.itemSpecifics.Season).toEqual(["Fall", "Winter"]);
  });
  it("country synonyms and team typos land on eBay's values", async () => {
    const tee = await enrichListing("k", ITEMS[0].v);
    expect(tee.itemSpecifics["Country/Region of Manufacture"]).toEqual(["United States"]);
    const jersey = await enrichListing("k", ITEMS[1].v);
    expect(jersey.itemSpecifics.Team).toEqual(["Pittsburgh Steelers"]);
    expect(jersey.itemSpecifics.Product).toEqual(["Jersey"]);
  });
  it("no Sleeve Length on jeans (not required there) and no Inseam on tops; required ones kept", async () => {
    const jeans = await enrichListing("k", ITEMS[3].v);
    expect(jeans.itemSpecifics["Sleeve Length"]).toBeUndefined();
    expect(jeans.aspectDefs.map((x) => x.name)).not.toContain("Sleeve Length");
    expect(jeans.itemSpecifics).toMatchObject({ "Waist Size": ["32 in"], Inseam: ["30 in"] });
    const tee = await enrichListing("k", ITEMS[0].v);
    expect(tee.aspectDefs.map((x) => x.name)).not.toContain("Inseam");
  });
  it("Sleeve Length (free text, no eBay values) offers curated suggestions in the dropdown", async () => {
    const tee = await enrichListing("k", ITEMS[0].v);
    const sl = defsForClient(tee.aspectDefs).find((x) => x.name === "Sleeve Length")!;
    expect(sl.mode).toBe("FREE_TEXT");
    expect(sl.values).toContain("Short Sleeve");
    expect(sl.curated).toBe(true);
    expect(tee.itemSpecifics["Sleeve Length"]).toEqual(["Short Sleeve"]);
  });
  it("aspects that aren't this category's are never sent", async () => {
    const r = await enrichListing("k", ITEMS[1].v);
    expect(r.itemSpecifics["Made Up Aspect"]).toBeUndefined();
    expect(r.itemSpecifics["Sleeve Length"]).toBeUndefined(); // the NFL category doesn't have it
    expect(r.itemSpecifics.Type).toBeUndefined();
  });
});
