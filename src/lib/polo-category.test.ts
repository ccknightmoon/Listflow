// Nov 25, 2026: a short-sleeve Lacoste polo was filed as outerwear. eBay
// category guards + the store-category shelf (Outerwear & Coats vs Tops).
import { describe, it, expect } from "vitest";
import { categoryFits, classifyGarment, consistencyIssues, kindFromTypeValue } from "./garment";
import { matchStoreCategoryByKeyword, storeCategoryConflict, storeCategoryKinds, type StoreCategoryLite } from "./store-category-match";
import { getListingReadiness } from "./listing-readiness";

const COATS = "Clothing, Shoes & Accessories > Men > Men's Clothing > Coats, Jackets & Vests";
const POLOS = "Clothing, Shoes & Accessories > Men > Men's Clothing > Shirts > Polos";
const TEES = "Clothing, Shoes & Accessories > Men > Men's Clothing > Shirts > T-Shirts";
const HOODIES = "Clothing, Shoes & Accessories > Men > Men's Clothing > Activewear > Hoodies & Sweatshirts";

describe("garment words map to the right eBay category", () => {
  it("polo / t-shirt / tee / shirt / tank are tops", () => {
    for (const t of ["Polo", "T-Shirt", "Tee", "Shirt", "Tank Top", "Polo Shirt"]) expect(classifyGarment(t, null)).toBe("top");
    expect(classifyGarment(null, "Vtg Lacoste Men's stripe Polo Shirt Size 9 Beige")).toBe("top");
  });
  it("a top never fits Coats, Jackets & Vests; a jacket never fits Polos/T-Shirts", () => {
    expect(categoryFits("top", COATS).ok).toBe(false);
    expect(categoryFits("top", POLOS).ok).toBe(true);
    expect(categoryFits("top", TEES).ok).toBe(true);
    expect(categoryFits("outerwear", COATS).ok).toBe(true);
    expect(categoryFits("outerwear", HOODIES).ok).toBe(true);
    expect(categoryFits("outerwear", POLOS).ok).toBe(false);
  });
  it("flags a Type vs category mismatch (Type Polo in Coats & Jackets)", () => {
    expect(kindFromTypeValue("Polo")).toBe("top");
    const issues = consistencyIssues({ title: "Lacoste Polo", kind: "top", categoryPath: COATS, aspects: { Type: ["Polo"] } });
    expect(issues.some((i) => /^Category looks wrong/.test(i))).toBe(true);
    expect(getListingReadiness({ photoCount: 1, title: "x", price: 20, condition: "Good", shippingMode: "calculated", categoryIssues: issues }).blockers)
      .toContain("Confirm the eBay category (it doesn't look right for this item)");
    expect(consistencyIssues({ title: "Lacoste Polo", kind: "top", categoryPath: POLOS, aspects: { Type: ["Polo"] } })).toEqual([]);
  });
});

describe("store category shelf", () => {
  const cats: StoreCategoryLite[] = [
    { id: "39947934017", name: "Outerwear & Coats", path: "Outerwear & Coats" },
    { id: "39947932017", name: "Tops, Tees & Sweaters", path: "Tops, Tees & Sweaters" },
    { id: "3", name: "Bottoms", path: "Bottoms" },
    { id: "4", name: "Vintage Band Tees", path: "Vintage Band Tees" },
  ];
  it("a polo goes to Tops, Tees & Sweaters; a jacket to Outerwear & Coats; jeans to Bottoms", () => {
    expect(matchStoreCategoryByKeyword({ title: "Vtg Lacoste Men's stripe Polo Shirt Size 9 Beige", itemType: "Polo", brand: "Lacoste" }, cats)?.name).toBe("Tops, Tees & Sweaters");
    expect(matchStoreCategoryByKeyword({ title: "Carhartt Men's Jacket Brown Canvas", itemType: "Jacket" }, cats)?.name).toBe("Outerwear & Coats");
    expect(matchStoreCategoryByKeyword({ title: "Levi's 501 Jeans 32x30", itemType: "Jeans" }, cats)?.name).toBe("Bottoms");
    expect(matchStoreCategoryByKeyword({ title: "Vintage Band Tee Metallica", itemType: "T-Shirt" }, cats)?.name).toBe("Vintage Band Tees");
  });
  it("a polo on the Outerwear & Coats shelf is flagged and blocks listing", () => {
    expect(storeCategoryKinds("Outerwear & Coats")).toEqual(["outerwear"]);
    const issue = storeCategoryConflict({ title: "Lacoste Polo Shirt", itemType: "Polo" }, cats[0]);
    expect(issue).toMatch(/Outerwear & Coats/);
    expect(storeCategoryConflict({ title: "Lacoste Polo Shirt", itemType: "Polo" }, cats[1])).toBeNull();
    expect(storeCategoryConflict({ title: "Wool Sweater", itemType: "Sweater" }, cats[1])).toBeNull();
    expect(storeCategoryConflict({ title: "x", itemType: "Polo" }, { name: "New Arrivals" })).toBeNull();
    expect(getListingReadiness({ photoCount: 1, title: "x", price: 20, condition: "Good", shippingMode: "calculated", storeCategoryIssue: issue }).ready).toBe(false);
  });
});

describe("readiness: off-list specifics block listing", () => {
  it("Size 9 blocks with a plain message", () => {
    const r = getListingReadiness({ photoCount: 1, title: "x", price: 27.99, bestOfferFloor: "20", condition: "Good", shippingMode: "calculated", invalidSpecifics: [{ name: "Size", value: "9" }] });
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain(`Pick eBay's Size ("9" isn't on eBay's list)`);
  });
});
