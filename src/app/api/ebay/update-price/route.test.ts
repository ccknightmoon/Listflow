import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";

const { state, trading } = vi.hoisted(() => ({
  state: { supabase: null as unknown },
  trading: vi.fn(async (...args: unknown[]) => (void args, { status: 200, body: "<Ack>Success</Ack>" })),
}));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ user: { id: "u1" }, supabase: state.supabase, unauthorized: null }) }));
vi.mock("@/lib/ebay-connection", () => ({ requireEbayConnection: async () => ({ userId: "u1", ebayUserId: "s", refreshToken: "x", policies: {} }) }));
vi.mock("@/lib/ebay-inventory", async (orig) => ({
  ...(await orig<typeof import("@/lib/ebay-inventory")>()),
  tradingRequest: (...a: unknown[]) => trading(...a),
}));

import { POST } from "@/app/api/ebay/update-price/route";

const req = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as never;
const ID = "123456789012";

beforeEach(() => {
  trading.mockClear();
  state.supabase = fakeSupabase({ drafts: { data: { cost_basis: 6 } } }).client;
});

describe("POST /api/ebay/update-price", () => {
  it("refuses prices under $0.99 without calling eBay", async () => {
    const r = await POST(req({ listingId: ID, price: 0.5 }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/0\.99/);
    expect(trading).not.toHaveBeenCalled();
  });

  it("refuses a price below the item's cost", async () => {
    const r = await POST(req({ listingId: ID, price: 4, draftId: "d1" }));
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ floor: 6 });
    expect(trading).not.toHaveBeenCalled();
  });

  it("revises the price and updates only the seller's own draft", async () => {
    const fake = fakeSupabase({ drafts: { data: { cost_basis: 6 } } });
    state.supabase = fake.client;
    const r = await POST(req({ listingId: ID, price: 12.5, draftId: "d1" }));
    expect(await r.json()).toMatchObject({ success: true, price: 12.5 });
    expect(trading).toHaveBeenCalledTimes(1);
    expect(String(trading.mock.calls[0][1])).toContain("<StartPrice>12.50</StartPrice>");
    const update = fake.calls.find((c) => c.ops.some(([op]) => op === "update"))!;
    expect(update.ops).toContainEqual(["eq", ["user_id", "u1"]]);
  });

  it("rejects an invalid listing id", async () => {
    expect((await POST(req({ listingId: "abc", price: 10 }))).status).toBe(400);
  });
});
