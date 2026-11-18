import { describe, it, expect } from "vitest";
import { classifyGarment, categoryFits, categoryQueries, sanitizeForItem, consistencyIssues, aspectFitsKind, valueContradictsKind, measurementKeysFor, isFabricConstruction } from "./garment";
import { parseSuggestions, pickFitting } from "./category-choice";
import { matchAllowedValue } from "./item-specifics";
import { getListingReadiness } from "./listing-readiness";

describe("classifyGarment", () => {
  it("reads the item type first, then the title", () => {
    expect(classifyGarment("Jersey", "Nike Dallas Cowboys Michael Irvin #88 Jersey", { team: "Dallas Cowboys" })).toBe("sports-jersey");
    expect(classifyGarment("Jersey", "Nike Cowboys jersey #88")).toBe("sports-jersey");
    expect(classifyGarment("Jersey", "Plain jersey top")).toBe("top");
    expect(classifyGarment("T-Shirt", "Jersey knit tee")).toBe("top"); // fabric word never makes it pants
    expect(classifyGarment("Joggers", "Nike jersey joggers")).toBe("bottom");
    expect(classifyGarment(null, "Levi's 501 Jeans 32x30")).toBe("bottom");
    expect(classifyGarment("Hoodie", "")).toBe("outerwear");
    expect(classifyGarment("Baseball Cap", "")).toBe("hat");
    expect(classifyGarment("", "Mystery widget")).toBe("unknown");
  });
});

describe("categoryFits", () => {
  const P = (leaf: string) => `Clothing, Shoes & Accessories > Men > Men's Clothing > ${leaf}`;
  it("never puts tops in pants (and vice versa)", () => {
    expect(categoryFits("sports-jersey", P("Activewear > Activewear Pants")).ok).toBe(false);
    expect(categoryFits("top", P("Shorts")).ok).toBe(false);
    expect(categoryFits("bottom", P("Shirts > T-Shirts")).ok).toBe(false);
    expect(categoryFits("top", P("Shirts > T-Shirts")).ok).toBe(true);
    expect(categoryFits("bottom", P("Jeans")).ok).toBe(true);
    expect(categoryFits("sports-jersey", "Sports Mem, Cards & Fan Shop > Fan Apparel & Souvenirs > Football-NFL").ok).toBe(true);
    expect(categoryFits("hat", "Clothing, Shoes & Accessories > Men > Men's Accessories > Hats").ok).toBe(true);
    expect(categoryFits("hat", P("Shirts")).ok).toBe(false);
  });
});

describe("category queries", () => {
  it("are precise for sports jerseys", () => {
    const q = categoryQueries({ kind: "sports-jersey", itemType: "Jersey", brand: "Nike", team: "Dallas Cowboys", league: "NFL", player: "Michael Irvin" });
    expect(q[0]).toBe("Nike Dallas Cowboys Michael Irvin jersey");
    expect(q).toContain("NFL Dallas Cowboys football jersey");
  });
  it("use the garment type, not just 'men's used X'", () => {
    expect(categoryQueries({ kind: "top", itemType: "T-Shirt", brand: "Hanes", department: "Men" })[0]).toBe("Hanes men's T-Shirt");
  });
});

describe("suggestion parsing and picking", () => {
  const data = {
    categorySuggestions: [
      { category: { categoryId: "1", categoryName: "Activewear Pants" }, categoryTreeNodeAncestors: [{ categoryName: "Activewear", categoryTreeNodeLevel: 4 }, { categoryName: "Men's Clothing", categoryTreeNodeLevel: 3 }, { categoryName: "Men", categoryTreeNodeLevel: 2 }, { categoryName: "Clothing, Shoes & Accessories", categoryTreeNodeLevel: 1 }] },
      { category: { categoryId: "2", categoryName: "Football-NFL" }, categoryTreeNodeAncestors: [{ categoryName: "Fan Apparel & Souvenirs", categoryTreeNodeLevel: 2 }, { categoryName: "Sports Mem, Cards & Fan Shop", categoryTreeNodeLevel: 1 }] },
    ],
  };
  it("builds root→leaf paths and skips suggestions that don't fit", () => {
    const s = parseSuggestions(data);
    expect(s[0].path).toBe("Clothing, Shoes & Accessories > Men > Men's Clothing > Activewear > Activewear Pants");
    const pick = pickFitting("sports-jersey", [{ query: "q", suggestions: s }]);
    expect(pick).toMatchObject({ categoryId: "2", needsReview: false });
    expect(pick.rejected[0].reason).toMatch(/pants/);
    expect(pickFitting("sports-jersey", [{ query: "q", suggestions: [s[0]] }]).needsReview).toBe(true);
  });
});

describe("aspect guards", () => {
  it("removes cross-garment aspects, contradicting Type, players as Character, 'Jersey' material, unverified vintage", () => {
    const r = sanitizeForItem(
      { Type: ["Joggers"], Inseam: ["30 in"], Character: ["IRVIN"], "Character Family": ["Dallas Cowboys"], Player: ["Michael Irvin"], Team: ["Dallas Cowboys"], Material: ["Jersey"], Vintage: ["No"], Brand: ["Nike"] },
      "sports-jersey",
    );
    expect(r.aspects).toEqual({ Player: ["Michael Irvin"], Team: ["Dallas Cowboys"], "Fabric Type": ["Jersey"], Brand: ["Nike"] });
    expect(r.removed.map((x) => x.name)).toEqual(["Type", "Inseam", "Character", "Character Family", "Material", "Vintage"]);
  });
  it("keeps real characters on non-sports items, and vintage when evidenced", () => {
    expect(sanitizeForItem({ Character: ["Mickey Mouse"], Vintage: ["Yes"] }, "top", { vintageEvidence: true }).aspects).toEqual({ Character: ["Mickey Mouse"], Vintage: ["Yes"] });
  });
  it("knows which aspects and measurements belong to which garment", () => {
    expect(aspectFitsKind("Inseam", "top")).toBe(false);
    expect(aspectFitsKind("Sleeve Length", "bottom")).toBe(false);
    expect(aspectFitsKind("Size Type", "hat")).toBe(false);
    expect(valueContradictsKind("Type", "Joggers", "sports-jersey")).toBe(true);
    expect(valueContradictsKind("Type", "Jersey", "sports-jersey")).toBe(false);
    expect([...measurementKeysFor("top")]).toEqual(["pitToPit", "length", "sleeve", "shoulder"]);
    expect(measurementKeysFor("bottom").has("pitToPit")).toBe(false);
    expect(isFabricConstruction("Jersey")).toBe(true);
    expect(isFabricConstruction("Polyester")).toBe(false);
  });
  it("selection-only matching never grabs a longer, different value", () => {
    expect(matchAllowedValue("Jersey", { mode: "SELECTION_ONLY", values: ["Jersey Knit Joggers", "Pants"] })).toBeNull();
  });
});

describe("self-check", () => {
  it("flags the live bug's contradictions", () => {
    const issues = consistencyIssues({
      title: "Nike Dallas Cowboys Michael Irvin #88 Jersey",
      kind: "sports-jersey",
      categoryPath: "Clothing, Shoes & Accessories > Men > Men's Clothing > Activewear > Activewear Pants",
      aspects: { Type: ["Joggers"], Inseam: ["30 in"] },
      measurementKeys: ["inseam"],
    });
    expect(issues[0]).toMatch(/^Category looks wrong: a top in a pants\/shorts category/);
    expect(issues.join(" ")).toMatch(/Joggers/);
    expect(issues.join(" ")).toMatch(/inseam/);
    expect(issues.join(" ")).toMatch(/"Inseam" doesn't apply/);
  });
  it("blocks listing until the category is confirmed", () => {
    const r = getListingReadiness({ photoCount: 2, title: "T", price: 10, condition: "Excellent used", shippingMode: "calculated", categoryIssues: ["Category looks wrong: x"] });
    expect(r.blockers).toContain("Confirm the eBay category (it doesn't look right for this item)");
    expect(getListingReadiness({ photoCount: 2, title: "T", price: 10, condition: "Excellent used", shippingMode: "calculated", categoryNeedsReview: true }).ready).toBe(false);
  });
});
