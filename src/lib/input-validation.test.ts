import { describe, it, expect } from "vitest";
import { draftFieldsError, imageListError, uuidList, isPhotoUrl } from "@/lib/input-validation";

const U = "11111111-2222-3333-4444-555555555555";

describe("draftFieldsError", () => {
  it("accepts a normal draft body", () => {
    expect(draftFieldsError({ title: "Vintage tee", suggestedPrice: 24.99, vintage: true, yearManufactured: 1994, photoUrls: ["https://x.supabase.co/a.jpg", `/api/photos/${U}/a.jpg`], ebayListingId: null })).toBeNull();
  });
  it("rejects wrong types and absurd sizes", () => {
    expect(draftFieldsError({ title: { evil: 1 } })).toMatch(/title/);
    expect(draftFieldsError({ description: "x".repeat(50_001) })).toMatch(/description/);
    expect(draftFieldsError({ suggestedPrice: -1 })).toMatch(/suggestedPrice/);
    expect(draftFieldsError({ suggestedPrice: "12" })).toMatch(/suggestedPrice/);
    expect(draftFieldsError({ ebayListingId: "abc" })).toMatch(/ebayListingId/);
    expect(draftFieldsError({ photoUrls: ["javascript:alert(1)"] })).toMatch(/photoUrls/);
    expect(draftFieldsError({ photoUrls: Array(25).fill("https://a.b/c.jpg") })).toMatch(/photoUrls/);
  });
});

describe("imageListError", () => {
  it("checks count, shape and size", () => {
    expect(imageListError([{ data: "abc", mediaType: "image/jpeg" }], 5)).toBeNull();
    expect(imageListError([{ url: "https://a.b/c.jpg" }], 5)).toBeNull();
    expect(imageListError([], 5)).toMatch(/At least/);
    expect(imageListError(Array(6).fill({ data: "a" }), 5)).toMatch(/At most/);
    expect(imageListError([{ data: "a", mediaType: "text/html" }], 5)).toMatch(/type/);
    expect(imageListError([{}], 5)).toMatch(/data or a link/);
  });
});

describe("uuidList / isPhotoUrl", () => {
  it("validates", () => {
    expect(uuidList([U])).toEqual([U]);
    expect(uuidList(["1"])).toBeNull();
    expect(uuidList([])).toBeNull();
    expect(isPhotoUrl("http://i.ebayimg.com/a.jpg")).toBe(true);
    expect(isPhotoUrl("data:image/png;base64,AAAA")).toBe(false);
  });
});
