import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { fakeSupabase } from "@/test/fake-supabase";

const { state } = vi.hoisted(() => ({ state: { supabase: null as unknown } }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ user: { id: "u1" }, supabase: state.supabase, unauthorized: null as null | NextResponse }),
}));
vi.mock("@/lib/jobs/supabase-store", () => ({ serviceDb: () => state.supabase }));

import { GET } from "@/app/api/drafts/route";
import { PATCH } from "@/app/api/drafts/[id]/route";

const ID = "6dbf996a-f066-459c-963c-91d578081875";
let fake: ReturnType<typeof fakeSupabase>;
beforeEach(() => {
  fake = fakeSupabase({ drafts: { data: [], count: 0 } });
  state.supabase = fake.client;
});

const orders = () => fake.calls.find((c) => c.table === "drafts")!.ops.filter(([m]) => m === "order").map(([, a]) => a[0]);

describe("GET /api/drafts", () => {
  it("only returns drafts that aren't on eBay", async () => {
    await GET(new Request("http://x/api/drafts") as never);
    expect(fake.calls[0].ops).toContainEqual(["is", ["ebay_listing_id", null]]);
  });

  it("default order is newest saved first with a stable tiebreak", async () => {
    await GET(new Request("http://x/api/drafts") as never);
    expect(orders()).toEqual(["created_at", "id"]);
  });

  it("'Last edited' sorts by updated_at", async () => {
    await GET(new Request("http://x/api/drafts?sort=edited") as never);
    expect(orders()).toEqual(["updated_at", "created_at", "id"]);
  });
});

describe("PATCH /api/drafts/[id]", () => {
  const patch = (body: unknown) =>
    PATCH(new Request(`http://x/api/drafts/${ID}`, { method: "PATCH", body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: ID }) });

  it("a client save can never clear the eBay link (only server delist/relist can)", async () => {
    fake = fakeSupabase({ drafts: { data: { id: ID } } });
    state.supabase = fake.client;
    await patch({ title: "x", ebayListingId: null });
    const upd = fake.calls.find((c) => c.ops.some(([m]) => m === "update"))!;
    expect(upd.ops.find(([m]) => m === "update")![1][0]).not.toHaveProperty("ebay_listing_id");
  });

  it("can still record an item number", async () => {
    fake = fakeSupabase({ drafts: { data: { id: ID } } });
    state.supabase = fake.client;
    await patch({ ebayListingId: "168900000001" });
    const upd = fake.calls.find((c) => c.ops.some(([m]) => m === "update"))!;
    expect(upd.ops.find(([m]) => m === "update")![1][0]).toMatchObject({ ebay_listing_id: "168900000001" });
  });
});
