import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { fakeSupabase } from "@/test/fake-supabase";

const { state, ebayCall } = vi.hoisted(() => ({
  state: { user: null, supabase: null, connected: true } as { user: { id: string } | null; supabase: unknown; connected: boolean },
  // Any eBay call from a validation path is a bug: make them all blow up.
  ebayCall: vi.fn((): unknown => { throw new Error("eBay must not be called"); }),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: async () =>
    state.user
      ? { user: state.user, supabase: state.supabase, unauthorized: null }
      : { user: null, supabase: state.supabase, unauthorized: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) },
}));
vi.mock("@/lib/ebay-connection", () => ({
  requireEbayConnection: async () => (state.connected ? { userId: "u1", ebayUserId: "seller", refreshToken: "x", policies: {} } : null),
}));
vi.mock("@/lib/ebay-inventory", async (orig) => {
  const real = await orig<typeof import("@/lib/ebay-inventory")>();
  const stub = Object.fromEntries(Object.keys(real).filter((k) => typeof (real as Record<string, unknown>)[k] === "function").map((k) => [k, ebayCall]));
  return { ...stub, CONDITION_MAP: real.CONDITION_MAP };
});

import { POST } from "@/app/api/ebay/list/route";

const req = (body: unknown) =>
  new Request("http://x/api/ebay/list", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }) as never;

const goodDraft = {
  id: "d1", user_id: "u1", title: "Nike Hoodie Mens L", suggested_price: 25, condition: "Excellent used",
  photo_urls: ["https://x/1.jpg"], ebay_listing_id: null,
};

function setup(draft: unknown, error: unknown = null) {
  const fake = fakeSupabase({ drafts: { data: draft, error }, app_settings: { data: null } });
  state.supabase = fake.client;
  return fake;
}

beforeEach(() => {
  state.user = { id: "u1" };
  state.connected = true;
  ebayCall.mockClear();
  setup(goodDraft);
});

describe("POST /api/ebay/list", () => {
  it("rejects signed-out callers", async () => {
    state.user = null;
    expect((await POST(req({ draftId: "d1" }))).status).toBe(401);
  });

  it("rejects bad JSON and a missing draftId", async () => {
    expect((await POST(req("{nope"))).status).toBe(400);
    const r = await POST(req({}));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/draftId/);
  });

  it("asks to connect eBay when not connected", async () => {
    state.connected = false;
    const r = await POST(req({ draftId: "d1" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ connect: true });
  });

  it("404s a draft that isn't found, and scopes the lookup to the signed-in seller", async () => {
    const fake = setup(null, { message: "no rows" });
    const r = await POST(req({ draftId: "someone-elses" }));
    expect(r.status).toBe(404);
    const draftsCall = fake.calls.find((c) => c.table === "drafts")!;
    expect(draftsCall.ops).toContainEqual(["eq", ["user_id", "u1"]]);
  });

  it("doesn't re-publish an already-listed draft (idempotent retry)", async () => {
    setup({ ...goodDraft, ebay_listing_id: "123456789012" });
    const r = await POST(req({ draftId: "d1" }));
    expect(await r.json()).toMatchObject({ success: true, alreadyListed: true, listingId: "123456789012" });
    expect(ebayCall).not.toHaveBeenCalled();
  });

  it.each([
    [{ photo_urls: [], thumbnail_url: null }, /photo/],
    [{ photo_urls: Array(25).fill("u") }, /24 photos/],
    [{ title: "  " }, /title/],
    [{ title: "x".repeat(81) }, /80 characters/],
    [{ suggested_price: 0 }, /price/],
    [{ suggested_price: null }, /price/],
    [{ condition: "Mint-ish" }, /condition/],
  ])("blocks an unready draft %#", async (patch, msg) => {
    setup({ ...goodDraft, ...patch });
    const r = await POST(req({ draftId: "d1" }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(msg);
    expect(ebayCall).not.toHaveBeenCalled();
  });
});
