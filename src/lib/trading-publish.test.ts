import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import type { TradingItemInput, TradingResult } from "@/lib/trading-listing";

const { aspectDefsMock } = vi.hoisted(() => ({ aspectDefsMock: { defs: [] as unknown[] } }));
vi.mock("@/lib/ebay-aspects", () => ({
  fetchAspectDefs: async () => aspectDefsMock.defs,
  fetchAllowedConditions: async () => ["USED_EXCELLENT", "PRE_OWNED_EXCELLENT"],
}));
vi.mock("@/lib/ebay-inventory", async (orig) => {
  const real = await orig<typeof import("@/lib/ebay-inventory")>();
  return {
    ...real,
    tradingRequest: vi.fn(() => { throw new Error("network not allowed in tests"); }),
    inventoryRequest: vi.fn(async (_m: string, path: string) =>
      path.includes("return_policy")
        ? { status: 200, data: { returnPolicies: [{ returnPolicyId: "R1", categoryTypes: [{ default: true }] }] } }
        : { status: 200, data: { paymentPolicies: [{ paymentPolicyId: "P1" }] } }),
  };
});

import { publishDraftTrading, reviseDraftListing, verifyWithFixes } from "@/lib/trading-publish";

const ok = (itemId: string | null = null, extra: Partial<TradingResult> = {}): TradingResult => ({ ack: "Success", ok: true, itemId, errors: [], warnings: [], feesTotal: 0, startTime: null, ...extra });
const fail = (code: string, msg: string, params: string[] = []): TradingResult => ({ ack: "Failure", ok: false, itemId: null, errors: [{ code, severity: "Error", short: msg, long: msg, params }], warnings: [], feesTotal: null, startTime: null });

const draft = {
  id: "11111111-2222-3333-4444-555555555555", title: "Nike Hoodie Mens L", condition: "Excellent used", flaws: "", suggested_price: 25,
  photo_urls: ["https://x/1.jpg", "http://i.ebayimg.com/2.jpg"], thumbnail_url: null, item_type: "Hoodie", size: "L", material: "Cotton",
  custom_sku: "1001", store_category_id: null, ebay_listing_id: null,
};

let fake: ReturnType<typeof fakeSupabase>;
const args = (over: Record<string, unknown> = {}) => ({
  supabase: fake.client as never, userId: "u1", draft, sku: "1001", categoryId: "155183", storeFooter: null,
  shippingProfileId: "S1", savedReturnProfileId: null, ...over,
});

beforeEach(() => { fake = fakeSupabase({ drafts: { data: null } }); });

describe("publishDraftTrading", () => {
  it("verifies first, then lists once, and saves the item number", async () => {
    fake = fakeSupabase({ drafts: { data: { id: draft.id, ebay_listing_id: "256000000001" } } }); // the saved row echoes back
    const calls: Array<[string, TradingItemInput]> = [];
    const call = vi.fn(async (c: string, item: TradingItemInput) => { calls.push([c, item]); return c === "AddFixedPriceItem" ? ok("256000000001") : ok(); });
    const res = await publishDraftTrading(args(), call as never);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, listingId: "256000000001" });
    expect(body.linkWarning).toBeUndefined();
    expect(calls.map((c) => c[0])).toEqual(["VerifyAddFixedPriceItem", "AddFixedPriceItem"]);
    const item = calls[1][1];
    expect(item.uuid).toMatch(/^[0-9A-F]{32}$/);
    expect(item.policies).toEqual({ shippingProfileId: "S1", returnProfileId: "R1", paymentProfileId: "P1" });
    expect(item.pictureUrls).toEqual(["https://x/1.jpg", "https://i.ebayimg.com/2.jpg"]);
    // "Excellent used" -> the category's own top pre-owned tier (apparel: 2990).
    expect(item.conditionId).toBe(2990);
    const upd = fake.calls.find((c) => c.table === "drafts" && c.ops.some(([m]) => m === "update"))!;
    expect(upd.ops[0]).toEqual(["update", [{ ebay_listing_id: "256000000001", shipping_mode: "calculated" }]]);
  });

  it("verify-only never lists", async () => {
    const call = vi.fn(async () => ok(null, { feesTotal: 0.35 }));
    const res = await publishDraftTrading(args({ verifyOnly: true }), call as never);
    expect(await res.json()).toMatchObject({ success: true, verifyOnly: true, feesTotal: 0.35 });
    expect(call).toHaveBeenCalledTimes(1);
    expect(fake.calls.some((c) => c.ops.some(([m]) => m === "update"))).toBe(false);
  });

  it("a duplicate UUID returns the existing listing instead of listing twice", async () => {
    const call = vi.fn(async (c: string) => (c === "AddFixedPriceItem" ? fail("488", "Duplicate UUID used.", ["X", "256000000009"]) : ok()));
    expect(await (await publishDraftTrading(args(), call as never)).json()).toMatchObject({ success: true, listingId: "256000000009", duplicateRecovered: true });
  });

  it("reports eBay's errors and never lists when verify fails", async () => {
    const call = vi.fn(async (c: string) => { void c; return fail("240", "The title is too long."); });
    const res = await publishDraftTrading(args(), call as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/title is too long.*240/);
    expect(call.mock.calls.every(([c]) => c === "VerifyAddFixedPriceItem")).toBe(true);
  });

  it("schedules 'Finish on eBay' listings", async () => {
    const call = vi.fn(async (c: string) => (c === "AddFixedPriceItem" ? ok("256000000002") : ok()));
    const json = await (await publishDraftTrading(args({ scheduleDays: 21 }), call as never)).json();
    expect(json.scheduledFor).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/);
    expect((call.mock.calls[1] as unknown as [string, TradingItemInput])[1].scheduleTime).toBe(json.scheduledFor);
  });
});

describe("verifyWithFixes", () => {
  it("drops the package type, then tries the other spelling of the same condition", async () => {
    const seen: TradingItemInput[] = [];
    const results = [fail("1", "Invalid ShippingPackage"), fail("21916884", "The condition is not valid for this category"), ok()];
    const call = vi.fn(async (_c: string, item: TradingItemInput) => { seen.push(item); return results.shift()!; });
    const r = await verifyWithFixes(draft as never, { categoryId: "155183", sku: "1", storeFooter: null }, {}, call as never);
    expect(r.result.ok).toBe(true);
    expect(seen[0].package?.packageType).toBeDefined();
    expect(seen[1].package?.packageType).toBeUndefined();
    expect(seen[2].conditionId).not.toBe(seen[1].conditionId);
  });
});

describe("reviseDraftListing", () => {
  it("revises in place with the item number", async () => {
    const call = vi.fn(async () => ok("256000000003"));
    const r = await reviseDraftListing({ ...draft, ebay_listing_id: "256000000003" } as never, { categoryId: "155183", sku: "1001", storeFooter: null }, call as never);
    expect(r.ok).toBe(true);
    expect((call.mock.calls[0] as unknown as [string, TradingItemInput])[1].itemId).toBe("256000000003");
  });
  it("flags legacy Inventory-API listings", async () => {
    const call = vi.fn(async () => fail("21919474", "Inventory-based listing management is not currently supported by this tool."));
    expect(await reviseDraftListing({ ...draft, ebay_listing_id: "256000000004" } as never, { categoryId: "1", sku: "1", storeFooter: null }, call as never)).toMatchObject({ ok: false, inventoryModel: true });
  });
});

describe("Best Offer floor on publish", () => {
  it("lists with Best Offer + auto-decline at the saved floor", async () => {
    fake = fakeSupabase({ drafts: { data: { id: draft.id, ebay_listing_id: "256000000010" } } });
    const calls: Array<[string, TradingItemInput]> = [];
    const call = vi.fn(async (c: string, item: TradingItemInput) => { calls.push([c, item]); return c === "AddFixedPriceItem" ? ok("256000000010") : ok(); });
    await publishDraftTrading(args({ draft: { ...draft, suggested_price: 28, best_offer_floor: 24 } }), call as never);
    expect(calls.map((c) => c[0])).toEqual(["VerifyAddFixedPriceItem", "AddFixedPriceItem"]);
    expect(calls[0][1].bestOffer).toEqual({ enabled: true, autoDecline: 24 });
    expect(calls[1][1].price).toBe(28);
    expect(calls[1][1].bestOffer).toEqual({ enabled: true, autoDecline: 24 });
  });
  it("no floor = Best Offer off on a new listing", async () => {
    const calls: TradingItemInput[] = [];
    const call = vi.fn(async (_c: string, item: TradingItemInput) => { calls.push(item); return ok("256000000011"); });
    await publishDraftTrading(args({ draft: { ...draft, best_offer_floor: null } }), call as never);
    expect(calls[0].bestOffer).toEqual({ enabled: false });
  });
  it("falls back to fixed price when eBay refuses Best Offer for the category", async () => {
    const results = [fail("21916000", "Best Offer is not enabled for this category."), ok(), ok("256000000012")];
    const seen: TradingItemInput[] = [];
    const call = vi.fn(async (_c: string, item: TradingItemInput) => { seen.push(item); return results.shift()!; });
    const body = await (await publishDraftTrading(args({ draft: { ...draft, suggested_price: 28, best_offer_floor: 24 } }), call as never)).json();
    expect(seen[1].bestOffer).toEqual({ enabled: false });
    expect(seen[2].bestOffer).toEqual({ enabled: false });
    expect(body.warnings?.[0]).toMatch(/Best Offer/);
  });
  it("revise sends the floor when saved, and leaves eBay's setting alone when not", async () => {
    const call = vi.fn(async () => ok("256000000013"));
    await reviseDraftListing({ ...draft, suggested_price: 28, best_offer_floor: "24", ebay_listing_id: "256000000013" } as never, { categoryId: "155183", sku: "1001", storeFooter: null }, call as never);
    expect((call.mock.calls[0] as unknown as [string, TradingItemInput])[1].bestOffer).toEqual({ enabled: true, autoDecline: 24 });
    call.mockClear();
    await reviseDraftListing({ ...draft, ebay_listing_id: "256000000013" } as never, { categoryId: "155183", sku: "1001", storeFooter: null }, call as never);
    expect((call.mock.calls[0] as unknown as [string, TradingItemInput])[1].bestOffer).toBeUndefined();
  });
});

describe("Size pre-flight + tag size in the title (Nov 25, 2026 Lacoste bug)", () => {
  it("titleWithMappedSize keeps the tag size and adds eBay's", async () => {
    const { titleWithMappedSize } = await import("@/lib/trading-publish");
    expect(titleWithMappedSize("Vtg Lacoste Men's stripe Polo Shirt Size 9 Beige", "9", "4XL", "Lacoste size 9 = 4XL"))
      .toBe("Vtg Lacoste Men's stripe Polo Shirt Size 9 (4XL) Beige");
    expect(titleWithMappedSize("Polo Size XXL", "XXL", "2XL", "Tag size XXL = 2XL")).toBe("Polo Size XXL"); // spelling fix only
    expect(titleWithMappedSize("A".repeat(75) + " Size 9", "9", "4XL", "Lacoste size 9 = 4XL")).toBe("A".repeat(75) + " Size 9"); // > 80
    expect(titleWithMappedSize("Lacoste Polo", "9", "4XL", "Lacoste size 9 = 4XL")).toBe("Lacoste Polo");
  });
  it("rejectedValuesError names the field and valid choices", async () => {
    const { rejectedValuesError } = await import("@/lib/trading-publish");
    expect(rejectedValuesError([])).toBeNull();
    expect(rejectedValuesError([{ name: "Size", value: "9", options: ["XS", "S", "M"] }])).toBe('"9" is not a valid value for Size. Pick one of eBay\'s values (e.g. XS, S, M).');
  });
});

describe("never sends an off-list Size to eBay", () => {
  const SIZES = ["2XS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "S/M"];
  const sizeDef = { name: "Size", required: true, recommended: false, mode: "FREE_TEXT", multi: false, values: SIZES };
  const brandDef = { name: "Brand", required: true, recommended: false, mode: "FREE_TEXT", multi: false, values: [] };
  it("an unmappable '9' stops before eBay with the field named (no Verify call)", async () => {
    aspectDefsMock.defs = [sizeDef, brandDef];
    try {
      const call = vi.fn(async () => ok());
      const d = { ...draft, title: "Nike Polo Size 9", brand: "Nike", size: "9", item_type: "Polo" };
      const res = await publishDraftTrading(args({ draft: d }), call as never);
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toMatch(/"9" is not a valid value for Size/);
      expect(call).not.toHaveBeenCalled();
    } finally { aspectDefsMock.defs = []; }
  });
  it("Lacoste '9' is sent as 4XL, title keeps the tag size", async () => {
    aspectDefsMock.defs = [sizeDef, brandDef];
    try {
      const calls: Array<[string, TradingItemInput]> = [];
      const call = vi.fn(async (c: string, item: TradingItemInput) => { calls.push([c, item]); return ok(); });
      const d = { ...draft, title: "Vtg Lacoste Men's stripe Polo Shirt Size 9 Beige", brand: "Lacoste", size: "9", item_type: "Polo" };
      const res = await publishDraftTrading(args({ draft: d, verifyOnly: true }), call as never);
      expect((await res.json()).verified).toBe(true);
      expect(calls[0][1].aspects?.Size).toEqual(["4XL"]);
      expect(calls[0][1].title).toBe("Vtg Lacoste Men's stripe Polo Shirt Size 9 (4XL) Beige");
      expect(calls.map((c) => c[0])).toEqual(["VerifyAddFixedPriceItem"]);
    } finally { aspectDefsMock.defs = []; }
  });
});
