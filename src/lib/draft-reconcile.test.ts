import { describe, it, expect } from "vitest";
import { findDraftListingMatches, listflowSkusFor, titleSimilarity, type ReconcileDraft, type ReconcileListing } from "@/lib/draft-reconcile";

const L = (listingId: string, title: string, sku: string | null = null, status: "active" | "scheduled" = "active"): ReconcileListing =>
  ({ listingId, title, sku, price: 10, thumbnail: null, status });
const D = (id: string, title: string | null, custom_sku: string | null = null): ReconcileDraft => ({ id, title, custom_sku });

const COWBOYS = D("6dbf996a-f066-459c-963c-91d578081875", "Nike Dallas Cowboys Jersey Navy Blue XL Sports Fan");
const STEELERS = D("8b237e9a-3bcf-419a-8898-05489e4ab323", "NFL Men's Jersey XXL Pittsburgh Steelers Black/Yellow V-Neck");

describe("findDraftListingMatches", () => {
  it("finds a draft listed in the eBay app by its title (the Cowboys case)", () => {
    const m = findDraftListingMatches([COWBOYS, STEELERS], [L("168900000001", "Nike Dallas Cowboys Jersey Navy Blue XL Sports Fan")]);
    expect(m).toEqual([expect.objectContaining({ draftId: COWBOYS.id, listingId: "168900000001", reason: "title", score: 1 })]);
  });

  it("ignores case, punctuation and word order", () => {
    expect(titleSimilarity("NFL Men's Jersey XXL", "nfl jersey mens xxl")).toBe(1);
  });

  it("prefers an exact SKU over a title", () => {
    const d = D("aaaaaaaa-0000-0000-0000-000000000001", "Carhartt Jacket Brown", "1656");
    const m = findDraftListingMatches([d], [L("1", "Carhartt Jacket Brown"), L("2", "Totally different title", "1656")]);
    expect(m).toEqual([expect.objectContaining({ listingId: "2", reason: "sku" })]);
  });

  it("matches the legacy auto-SKU formats", () => {
    const d = D("abcdef12-0000-0000-0000-000000000000", "x", null);
    expect(listflowSkusFor(d)).toContain("listflowabcdef12");
    expect(findDraftListingMatches([d], [L("9", "y", "listflow-abcdef12-0000-0000-0000-000000000000")])[0]?.reason).toBe("sku");
  });

  it("never offers a listing that's already linked to another draft", () => {
    expect(findDraftListingMatches([COWBOYS], [L("5", COWBOYS.title!)], ["5"])).toEqual([]);
  });

  it("uses each listing once and each draft once", () => {
    const twin = D("bbbbbbbb-0000-0000-0000-000000000002", COWBOYS.title);
    const m = findDraftListingMatches([COWBOYS, twin], [L("7", COWBOYS.title!)]);
    expect(m).toHaveLength(1);
  });

  it("doesn't pair different items that merely share words", () => {
    const m = findDraftListingMatches([STEELERS], [L("8", "NFL Men's Jersey XXL Dallas Cowboys Navy V-Neck")]);
    expect(m).toEqual([]);
  });

  it("does not match untitled drafts by title", () => {
    expect(findDraftListingMatches([D("cccccccc-0000-0000-0000-000000000003", null)], [L("1", "")])).toEqual([]);
  });

  it("keeps the scheduled/active status for the label", () => {
    expect(findDraftListingMatches([COWBOYS], [L("3", COWBOYS.title!, null, "scheduled")])[0].status).toBe("scheduled");
  });
});
