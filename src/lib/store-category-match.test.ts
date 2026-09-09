import { describe, it, expect } from "vitest";
import { matchStoreCategoryByKeyword, type StoreCategoryLite } from "./store-category-match";

function cat(id: string, name: string, path?: string): StoreCategoryLite {
  return { id, name, path: path ?? name };
}

describe("matchStoreCategoryByKeyword", () => {
  it("matches a singular item title against a plural category name (the 'Dress'/'Dresses' bug)", () => {
    const categories = [cat("1", "Dresses"), cat("2", "Jeans")];
    const result = matchStoreCategoryByKeyword({ title: "Little Black Dress", itemType: "Dress" }, categories);
    expect(result?.id).toBe("1");
  });

  it("matches an item whose singular form already ends in 'e' against its plural category ('Hoodie'/'Hoodies')", () => {
    const categories = [cat("1", "Hoodies"), cat("2", "Sweaters")];
    const result = matchStoreCategoryByKeyword({ title: "Vintage Nike Hoodie", itemType: "Hoodie" }, categories);
    expect(result?.id).toBe("1");
  });

  it("matches 'Purse'/'Purses' the same way", () => {
    const categories = [cat("1", "Purses"), cat("2", "Wallets")];
    const result = matchStoreCategoryByKeyword({ title: "Coach Leather Purse" }, categories);
    expect(result?.id).toBe("1");
  });

  it("matches true sibilant '-es' plurals (Boxes, Watches)", () => {
    expect(matchStoreCategoryByKeyword({ title: "Storage Box" }, [cat("1", "Boxes")])?.id).toBe("1");
    expect(matchStoreCategoryByKeyword({ title: "Rolex Watch" }, [cat("1", "Watches")])?.id).toBe("1");
  });

  it("does not match an unrelated category", () => {
    const categories = [cat("1", "Shorts"), cat("2", "Handbags")];
    const result = matchStoreCategoryByKeyword({ title: "Cotton Shirt", itemType: "Shirt" }, categories);
    expect(result).toBeNull();
  });

  it("requires every significant word in the category name to match", () => {
    const categories = [cat("1", "Vintage Band Tees")];
    expect(matchStoreCategoryByKeyword({ title: "Band Tee" }, categories)).toBeNull();
    expect(matchStoreCategoryByKeyword({ title: "Vintage Band Tee" }, categories)?.id).toBe("1");
  });

  it("prefers the most specific (most-worded) of several fully-matching categories", () => {
    const categories = [cat("1", "Tees"), cat("2", "Vintage Band Tees")];
    const result = matchStoreCategoryByKeyword({ title: "Vintage Rolling Stones Band Tee" }, categories);
    expect(result?.id).toBe("2");
  });

  it("returns null when there are no categories or no usable item text", () => {
    expect(matchStoreCategoryByKeyword({ title: "Dress" }, [])).toBeNull();
    expect(matchStoreCategoryByKeyword({}, [cat("1", "Dresses")])).toBeNull();
  });

  it("ignores stop words in the category name", () => {
    const categories = [cat("1", "Tops & Blouses")];
    const result = matchStoreCategoryByKeyword({ title: "Silk Blouse", itemType: "Top" }, categories);
    expect(result?.id).toBe("1");
  });
});
