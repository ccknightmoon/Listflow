// /api/ebay/list with the Trading API (default): dispatch, rollback flag,
// in-place update and the two-way-sync conflict check. eBay calls mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";
import { fakeSupabase } from "@/test/fake-supabase";

const m = vi.hoisted(() => ({
  state: { supabase: null as unknown },
  publish: vi.fn(async () => NextResponse.json({ success: true, listingId: "256000000001" })),
  revise: vi.fn(async () => ({ ok: true })),
  live: vi.fn(async () => ({ itemId: "256000000009", status: "Active", title: "T", price: 20 } as Record<string, unknown>)),
  hash: vi.fn(() => "a".repeat(32)),
}));

vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ user: { id: "u1" }, supabase: m.state.supabase, unauthorized: null }) }));
vi.mock("@/lib/ebay-connection", () => ({ requireEbayConnection: async () => ({ userId: "u1", ebayUserId: "s", refreshToken: "x", policies: { shippingCalculatedId: "C1" } }) }));
vi.mock("@/lib/ebay-inventory", async (orig) => {
  const real = await orig<typeof import("@/lib/ebay-inventory")>();
  return {
    ...real,
    inventoryRequest: vi.fn(async () => ({ status: 200, data: { fulfillmentPolicies: [{ fulfillmentPolicyId: "C1", name: "Calc", shippingOptions: [{ optionType: "DOMESTIC", costType: "CALCULATED" }] }] } })),
    ensureMerchantLocation: vi.fn(async () => { throw new Error("inventory path must not run"); }),
    tradingRequest: vi.fn(async () => { throw new Error("no network"); }),
  };
});
vi.mock("@/lib/ebay-category", () => ({ chooseCategory: async () => ({ categoryId: "155183" }) }));
vi.mock("@/lib/trading-publish", () => ({ publishDraftTrading: m.publish, reviseDraftListing: m.revise }));
vi.mock("@/lib/ebay-item", () => ({ getLiveItem: m.live, liveItemHash: m.hash, isEndedStatus: (s: string) => s === "Completed" || s === "Ended" }));
vi.mock("@/lib/ebay-item-import", () => ({ markSynced: vi.fn(async () => {}) }));

import { POST } from "@/app/api/ebay/list/route";

const req = (body: unknown) => new Request("http://x/api/ebay/list", { method: "POST", body: JSON.stringify(body) }) as never;
const draft = { id: "d1", user_id: "u1", title: "Nike Hoodie Mens L", suggested_price: 25, condition: "Excellent used", photo_urls: ["https://x/1.jpg"], ebay_listing_id: null, custom_sku: "1001", item_type: "Hoodie" };

beforeEach(() => {
  m.state.supabase = fakeSupabase({ drafts: { data: draft }, app_settings: { data: null }, ebay_connections: { data: null } }).client;
  m.publish.mockClear();
  m.revise.mockClear();
});
afterEach(() => { delete process.env.PUBLISH_API; });

describe("POST /api/ebay/list (Trading API)", () => {
  it("publishes a new draft through the Trading path", async () => {
    const r = await POST(req({ draftId: "d1" }));
    expect(await r.json()).toMatchObject({ success: true, listingId: "256000000001" });
    expect(m.publish).toHaveBeenCalledTimes(1);
    expect((m.publish.mock.calls[0] as unknown as [Record<string, unknown>])[0]).toMatchObject({ sku: "1001", categoryId: "155183", shippingProfileId: "C1", verifyOnly: false });
  });

  it("passes verify-only and schedule requests through", async () => {
    await POST(req({ draftId: "d1", verifyOnly: true, scheduleDays: 21 }));
    expect((m.publish.mock.calls[0] as unknown as [Record<string, unknown>])[0]).toMatchObject({ verifyOnly: true, scheduleDays: 21 });
  });

  it("PUBLISH_API=inventory refuses verify-only/scheduled (Trading-only features)", async () => {
    process.env.PUBLISH_API = "inventory";
    const r = await POST(req({ draftId: "d1", verifyOnly: true }));
    expect(r.status).toBe(400);
    expect(m.publish).not.toHaveBeenCalled();
  });

  it("updates a listed draft in place when eBay hasn't changed", async () => {
    m.state.supabase = fakeSupabase({ drafts: { data: { ...draft, ebay_listing_id: "256000000009" } }, app_settings: { data: null }, ebay_connections: { data: null } }).client;
    const r = await POST(req({ draftId: "d1", allowRelist: true, baseHash: "a".repeat(32) }));
    expect(await r.json()).toMatchObject({ success: true, revised: true, listingId: "256000000009" });
    expect(m.revise).toHaveBeenCalledTimes(1);
  });

  it("refuses to overwrite eBay-side edits without confirmation", async () => {
    m.state.supabase = fakeSupabase({ drafts: { data: { ...draft, ebay_listing_id: "256000000009" } }, app_settings: { data: null }, ebay_connections: { data: null } }).client;
    const r = await POST(req({ draftId: "d1", allowRelist: true, baseHash: "b".repeat(32) }));
    expect(await r.json()).toMatchObject({ conflict: true });
    expect(m.revise).not.toHaveBeenCalled();
    const forced = await POST(req({ draftId: "d1", allowRelist: true, baseHash: "b".repeat(32), force: true }));
    expect(await forced.json()).toMatchObject({ revised: true });
  });
});
