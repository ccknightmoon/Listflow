// Regression suite for the Nov 2026 bug: a Nike Dallas Cowboys Michael Irvin
// #88 jersey was put in a pants/joggers category and filled with pants
// specifics. Runs the REAL category picker, aspect filler and guards against
// a fake eBay taxonomy whose FIRST suggestion is deliberately wrong.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { ai } = vi.hoisted(() => ({ ai: vi.fn() }));
vi.mock("@/lib/openai-request", () => ({ openAIPost: (...a: unknown[]) => ai(...a) }));

const C = {
  pants: { id: "185101", path: "Clothing, Shoes & Accessories > Men > Men's Clothing > Activewear > Activewear Pants" },
  nfl: { id: "24511", path: "Sports Mem, Cards & Fan Shop > Fan Apparel & Souvenirs > Football-NFL" },
  tees: { id: "15687", path: "Clothing, Shoes & Accessories > Men > Men's Clothing > Shirts > T-Shirts" },
  hoodies: { id: "155183", path: "Clothing, Shoes & Accessories > Men > Men's Clothing > Activewear > Hoodies & Sweatshirts" },
  jeans: { id: "11483", path: "Clothing, Shoes & Accessories > Men > Men's Clothing > Jeans" },
  jackets: { id: "57988", path: "Clothing, Shoes & Accessories > Men > Men's Clothing > Coats, Jackets & Vests" },
  shorts: { id: "15689", path: "Clothing, Shoes & Accessories > Men > Men's Clothing > Shorts" },
  hats: { id: "52365", path: "Clothing, Shoes & Accessories > Men > Men's Accessories > Hats" },
};
const sugg = (...cs: Array<{ id: string; path: string }>) => ({
  categorySuggestions: cs.map((c) => {
    const parts = c.path.split(" > ");
    return { category: { categoryId: c.id, categoryName: parts[parts.length - 1] }, categoryTreeNodeAncestors: parts.slice(0, -1).reverse().map((n, i, arr) => ({ categoryName: n, categoryTreeNodeLevel: arr.length - i })) };
  }),
});

// Fake eBay: "jersey" alone means fabric to eBay → pants first (the real bug).
function fakeSuggest(q: string) {
  const s = q.toLowerCase();
  if (/cowboys|nfl|football/.test(s)) return sugg(C.pants, C.nfl);
  if (/jersey/.test(s)) return sugg(C.pants, C.tees);
  if (/hoodie|sweatshirt/.test(s)) return sugg(C.pants, C.hoodies);
  if (/t-?shirt|tee/.test(s)) return sugg(C.shorts, C.tees);
  if (/jeans/.test(s)) return sugg(C.tees, C.jeans);
  if (/jacket|coat/.test(s)) return sugg(C.pants, C.jackets);
  if (/shorts/.test(s)) return sugg(C.tees, C.shorts);
  if (/hat|cap/.test(s)) return sugg(C.tees, C.hats);
  return sugg();
}

const def = (name: string, required: boolean, values: string[] = [], mode = "FREE_TEXT", multi = false) => ({
  localizedAspectName: name,
  aspectConstraint: { aspectRequired: required, aspectUsage: required ? "REQUIRED" : "RECOMMENDED", aspectMode: mode, itemToAspectCardinality: multi ? "MULTI" : "SINGLE" },
  aspectValues: values.map((v) => ({ localizedValue: v })),
});
const COMMON = [def("Brand", true), def("Size", true), def("Color", false, [], "FREE_TEXT", true), def("Material", false, ["Polyester", "Cotton", "Nylon"]), def("Features", false, ["Pockets", "Hood"], "FREE_TEXT", true), def("Closure", false, ["Snap", "Zip", "Button", "Pull On"]), def("Character", false), def("Character Family", false), def("Vintage", false, ["Yes", "No"])];
const DEFS: Record<string, unknown[]> = {
  [C.pants.id]: [...COMMON, def("Inseam", true), def("Type", true, ["Joggers", "Pants"], "SELECTION_ONLY"), def("Rise", false), def("Waist Size", false)],
  [C.nfl.id]: [def("Team", true), def("League", false, ["NFL"]), def("Player", false), def("Sport", false, ["Football"]), def("Size", true), def("Brand", false), def("Color", false), def("Material", false, ["Polyester", "Cotton"]), def("Product", false, ["Jersey", "T-Shirt"], "SELECTION_ONLY"), def("Character", false), def("Vintage", false, ["Yes", "No"])],
  [C.tees.id]: [...COMMON, def("Type", true, ["T-Shirt"]), def("Sleeve Length", false), def("Neckline", false)],
  [C.hoodies.id]: [...COMMON, def("Type", true, ["Hoodie", "Sweatshirt"]), def("Sleeve Length", false)],
  [C.jeans.id]: [...COMMON, def("Inseam", true), def("Waist Size", true), def("Rise", false), def("Type", false, ["Jeans"])],
  [C.jackets.id]: [...COMMON, def("Type", true, ["Jacket", "Coat"]), def("Sleeve Length", false), def("Outer Shell Material", false)],
  [C.shorts.id]: [...COMMON, def("Inseam", false), def("Waist Size", true), def("Type", false, ["Athletic", "Cargo", "Chino"])],
  [C.hats.id]: [def("Brand", true), def("Size", false), def("Color", false), def("Type", true, ["Baseball Cap", "Beanie"]), def("Material", false), def("Sleeve Length", false), def("Inseam", false)],
};

vi.mock("@/lib/ebay-inventory", async (orig) => ({
  ...(await orig<typeof import("@/lib/ebay-inventory")>()),
  inventoryRequest: async (_m: string, path: string) => {
    const q = decodeURIComponent(path.match(/[?&]q=([^&]*)/)?.[1] ?? "");
    if (path.includes("get_category_suggestions")) return { status: 200, data: fakeSuggest(q) };
    const id = path.match(/category_id=(\d+)/)?.[1] ?? "";
    if (path.includes("get_item_aspects_for_category")) return { status: 200, data: { aspects: DEFS[id] ?? [] } };
    return { status: 404, data: {} };
  },
}));

import { enrichListing } from "./listing-enrich";

// The text model "helpfully" picks the closest allowed values — the second half of the bug.
function aiPicksClosest() {
  ai.mockImplementation(async (_k: string, body: { messages: Array<{ content: string }> }) => {
    const p = body.messages[0].content;
    const out: Array<{ name: string; values: string[] }> = [];
    if (p.includes('"name":"Type"') && p.includes("Joggers")) out.push({ name: "Type", values: ["Joggers"] });
    if (p.includes('"name":"Closure"')) out.push({ name: "Closure", values: ["Snap"] });
    if (p.includes('"name":"Character"')) out.push({ name: "Character", values: ["IRVIN"] });
    if (p.includes('"name":"Character Family"')) out.push({ name: "Character Family", values: ["Dallas Cowboys"] });
    if (p.includes('"name":"Vintage"')) out.push({ name: "Vintage", values: ["No"] });
    return { choices: [{ message: { content: JSON.stringify({ aspects: out }) } }] };
  });
}

beforeEach(() => { ai.mockReset(); aiPicksClosest(); });

const BOTTOM_ASPECTS = ["Inseam", "Rise", "Waist Size"];
const TOP_ASPECTS = ["Sleeve Length", "Neckline"];
const has = (a: Record<string, string[]>, k: string) => Object.prototype.hasOwnProperty.call(a, k);

describe("Sel's Cowboys jersey (the live bug)", () => {
  const JERSEY = {
    itemType: "Jersey", department: "Men", brand: "Nike", color: "Navy", size: "XL", condition: "Excellent used", flaws: "",
    material: "Jersey", vintage: "No", character: "IRVIN", characterFamily: "Dallas Cowboys", tagText: "NIKE ON FIELD XL 100% POLYESTER",
    measurements: { pitToPit: "24", length: "31", inseam: "30" },
    specifics: { Team: "Dallas Cowboys", League: "NFL", Player: "Michael Irvin", Sport: "Football", "Jersey Number": "88" },
    suggestedTitle: "Nike Dallas Cowboys Michael Irvin #88 Jersey Men's XL Navy NFL Football",
  };
  it("lands in NFL fan apparel, not pants, even though eBay's first suggestion is pants", async () => {
    const r = await enrichListing("k", JERSEY);
    expect(r.categoryId).toBe(C.nfl.id);
    expect(r.categoryPath).toBe(C.nfl.path);
    expect(r.categoryNeedsReview).toBe(false);
    expect(r.garmentKind).toBe("sports-jersey");
  });
  it("has no pants specifics, no player-as-character, no 'Jersey' material, no unverified vintage", async () => {
    const r = await enrichListing("k", JERSEY);
    const a = r.itemSpecifics;
    for (const k of [...BOTTOM_ASPECTS, "Character", "Character Family", "Vintage", "Closure"]) expect(has(a, k), k).toBe(false);
    expect(a.Type ?? []).not.toContain("Joggers");
    expect(a.Material).toBeUndefined(); // "Jersey" is not a fiber
    expect(a).toMatchObject({ Team: ["Dallas Cowboys"], League: ["NFL"], Player: ["Michael Irvin"], Sport: ["Football"], Brand: ["Nike"], Size: ["XL"] });
    expect(r.missingRequired).toEqual([]);
    expect(r.measurementsList.map((m) => m.key)).toEqual(["pitToPit", "length"]); // inseam dropped for a top
    expect(r.issues).toEqual([]);
  });
});

const CASES: Array<{ name: string; v: Record<string, unknown>; cat: { id: string }; bottoms: boolean }> = [
  { name: "t-shirt", v: { itemType: "T-Shirt", department: "Men", brand: "Hanes", size: "L", color: "Black", material: "Cotton", suggestedTitle: "Hanes Men's Graphic T-Shirt Size L Black", measurements: { pitToPit: "21", inseam: "30" } }, cat: C.tees, bottoms: false },
  { name: "hoodie", v: { itemType: "Hoodie", department: "Men", brand: "Champion", size: "M", color: "Gray", suggestedTitle: "Champion Reverse Weave Hoodie Men's M Gray", measurements: { pitToPit: "22" } }, cat: C.hoodies, bottoms: false },
  { name: "jeans", v: { itemType: "Jeans", department: "Men", brand: "Levi's", size: "32x30", color: "Blue", suggestedTitle: "Levi's 501 Jeans Men's 32x30 Blue", measurements: { waist: "32", inseam: "30", pitToPit: "20" } }, cat: C.jeans, bottoms: true },
  { name: "jacket", v: { itemType: "Jacket", department: "Men", brand: "Carhartt", size: "XL", color: "Brown", suggestedTitle: "Carhartt Detroit Jacket Men's XL Brown", measurements: { pitToPit: "26" } }, cat: C.jackets, bottoms: false },
  { name: "shorts", v: { itemType: "Shorts", department: "Men", brand: "Nike", size: "L", color: "Black", suggestedTitle: "Nike Dri-FIT Shorts Men's L Black", measurements: { waist: "34", inseam: "7", pitToPit: "22" } }, cat: C.shorts, bottoms: true },
  { name: "hat", v: { itemType: "Baseball Cap", brand: "New Era", color: "Navy", suggestedTitle: "New Era Dallas Cowboys Snapback Hat Navy", measurements: { pitToPit: "10" } }, cat: C.hats, bottoms: false },
];

describe.each(CASES)("$name", ({ v, cat, bottoms }) => {
  it("lands in a sensible category with no cross-garment specifics", async () => {
    const r = await enrichListing("k", v);
    expect(r.categoryId).toBe(cat.id);
    expect(r.categoryNeedsReview).toBe(false);
    const a = r.itemSpecifics;
    const forbidden = bottoms ? TOP_ASPECTS : BOTTOM_ASPECTS;
    for (const k of forbidden) expect(has(a, k), k).toBe(false);
    expect(a.Type ?? []).not.toContain("Joggers");
    const keys = r.measurementsList.map((m) => m.key);
    if (bottoms) expect(keys).not.toContain("pitToPit");
    else expect(keys.some((k) => ["waist", "inseam", "rise"].includes(k))).toBe(false);
    expect(r.issues).toEqual([]);
  });
});

describe("when nothing eBay suggests fits", () => {
  it("falls back to a safe category and flags it for review instead of guessing", async () => {
    const r = await enrichListing("k", { itemType: "Jersey", brand: "Unknown", size: "M", suggestedTitle: "Plain Jersey Top Size M" });
    // fake eBay gives pants then tees for a plain "jersey" → tees fit
    expect(r.categoryId).toBe(C.tees.id);
    const r2 = await enrichListing("k", { itemType: "Widget", suggestedTitle: "Mystery widget thing" });
    expect(r2.categoryNeedsReview).toBe(true);
    expect(r2.issues[0]).toMatch(/choose one/);
  });
});
