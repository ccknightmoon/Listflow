import { describe, it, expect, vi, beforeEach } from "vitest";

const { trading } = vi.hoisted(() => ({ trading: { body: "", status: 200, calls: 0 } }));
vi.mock("@/lib/ebay-inventory", () => ({ tradingRequest: async () => { trading.calls++; return { status: trading.status, body: trading.body }; } }));
vi.mock("@/lib/ebay-sync", () => ({ syncDraftWithEbay: vi.fn(async () => ({ status: "updated" })) }));
vi.mock("@/lib/ebay-listings", () => ({ invalidateListings: vi.fn() }));
vi.mock("@/lib/sales-feed-cache", () => ({ invalidateSalesFeed: vi.fn() }));
vi.mock("@/lib/dashboard-summary", () => ({ invalidateDashboardSummary: vi.fn() }));

import { parseSellerEvents, classifyEvents, windowStart, parseState, runSyncPass, dismissUnlinked, MAX_WINDOW_MS, type SyncState } from "./ebay-auto-sync";
import { invalidateListings } from "@/lib/ebay-listings";
import { syncDraftWithEbay } from "@/lib/ebay-sync";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const item = (id: string, status: string, sold = 0, title = `Item ${id}`) =>
  `<Item><ItemID>${id}</ItemID><ListingDetails><StartTime>2026-11-25T10:00:00.000Z</StartTime></ListingDetails><SellingStatus><ListingStatus>${status}</ListingStatus><QuantitySold>${sold}</QuantitySold></SellingStatus><Title>${title}</Title></Item>`;
const events = (...items: string[]) => `<?xml version="1.0"?><GetSellerEventsResponse><Ack>Success</Ack><ItemArray>${items.join("")}</ItemArray></GetSellerEventsResponse>`;

describe("parseSellerEvents", () => {
  it("reads id, title, status, sold count and start", () => {
    expect(parseSellerEvents(events(item("111111111", "Active", 0, "Nike &amp; Co"), item("222222222", "Completed", 1)))).toEqual([
      { itemId: "111111111", title: "Nike & Co", status: "active", quantitySold: 0, startTime: "2026-11-25T10:00:00.000Z" },
      { itemId: "222222222", title: "Item 222222222", status: "completed", quantitySold: 1, startTime: "2026-11-25T10:00:00.000Z" },
    ]);
  });
  it("null on an eBay error", () => {
    expect(parseSellerEvents("<Ack>Failure</Ack>")).toBeNull();
  });
});

describe("classifyEvents", () => {
  const iso = new Date(NOW).toISOString();
  const ev = (itemId: string, status: string, quantitySold = 0) => ({ itemId, title: `T${itemId}`, status, quantitySold, startTime: null });
  it("sorts sold, ended, and new items with no Listflow draft", () => {
    const r = classifyEvents([ev("1", "completed", 1), ev("2", "ended"), ev("3", "active"), ev("4", "active")], new Set(["4"]), [], iso);
    expect(r.sold).toEqual(["1"]);
    expect(r.ended).toEqual(["2"]);
    expect(r.newUnlinked.map((u) => u.listingId)).toEqual(["3"]);
    expect(r.unlinked.map((u) => u.listingId)).toEqual(["3"]);
  });
  it("drops alert items once they're linked or no longer live; doesn't re-add known ones", () => {
    const prior = [{ listingId: "5", title: "a", seenAt: iso }, { listingId: "6", title: "b", seenAt: iso }, { listingId: "7", title: "c", seenAt: iso }];
    const r = classifyEvents([ev("6", "ended"), ev("7", "active")], new Set(["5"]), prior, iso);
    expect(r.unlinked.map((u) => u.listingId)).toEqual(["7"]);
    expect(r.newUnlinked).toEqual([]);
  });
});

describe("window + state", () => {
  it("never asks eBay for more than ~47 h", () => {
    expect(windowStart(null, NOW).getTime()).toBe(NOW - MAX_WINDOW_MS);
    expect(windowStart("2026-11-20T00:00:00Z", NOW).getTime()).toBe(NOW - MAX_WINDOW_MS);
    expect(windowStart("2026-11-25T11:50:00Z", NOW).toISOString()).toBe("2026-11-25T11:50:00.000Z");
  });
  it("parses junk safely", () => {
    expect(parseState(null).unlinked).toEqual([]);
    expect(parseState({ lastRunAt: 5, unlinked: [{ nope: 1 }, { listingId: "1", title: "x", seenAt: "" }] })).toMatchObject({ lastRunAt: null, unlinked: [{ listingId: "1" }] });
    const s: SyncState = { lastRunAt: null, lastChangeAt: null, lastError: null, unlinked: [{ listingId: "1", title: "", seenAt: "" }, { listingId: "2", title: "", seenAt: "" }] };
    expect(dismissUnlinked(s, ["1"]).unlinked.map((u) => u.listingId)).toEqual(["2"]);
  });
});

// Minimal app_settings/drafts fake.
function fakeDb(opts: { stateColumn: boolean; state?: unknown; eventsAt?: string | null; drafts?: Array<{ id: string; ebay_listing_id: string }> }) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    from(table: string) {
      let cols = "";
      let ids: string[] | null = null;
      const q: Record<string, unknown> = {
        select: (c: string) => { cols = c; return q; },
        eq: () => q,
        in: (_k: string, v: string[]) => { ids = v; return q; },
        update: (p: Record<string, unknown>) => { updates.push(p); return q; },
        maybeSingle: async () => {
          if (cols.includes("ebay_sync_state") && !opts.stateColumn) return { data: null, error: { message: "column ebay_sync_state does not exist" } };
          return { data: { ebay_sync_state: opts.state ?? null, ebay_events_synced_at: opts.eventsAt ?? null }, error: null };
        },
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: table === "drafts" ? (opts.drafts ?? []).filter((d) => !ids || ids.includes(d.ebay_listing_id)) : [], error: null }).then(res),
      };
      return q;
    },
  };
  return { db: db as never, updates };
}

describe("runSyncPass", () => {
  beforeEach(() => { trading.calls = 0; trading.status = 200; vi.mocked(invalidateListings).mockClear(); vi.mocked(syncDraftWithEbay).mockClear(); });

  it("records sold/ended, flags eBay-app listings, syncs edited linked drafts, drops caches", async () => {
    trading.body = events(item("100000001", "Completed", 1), item("100000002", "Active"), item("100000003", "Active"));
    const f = fakeDb({ stateColumn: true, drafts: [{ id: "d1", ebay_listing_id: "100000001" }, { id: "d3", ebay_listing_id: "100000003" }] });
    const r = await runSyncPass(f.db, "u1", { now: NOW });
    expect(r.summary).toMatchObject({ sold: ["100000001"], ended: [], edited: 1, changed: true });
    expect(r.state.unlinked.map((u) => u.listingId)).toEqual(["100000002"]);
    expect(syncDraftWithEbay).toHaveBeenCalledTimes(1); // only the live, linked one (sold one skipped)
    expect(invalidateListings).toHaveBeenCalledWith("u1");
    expect(f.updates.some((u) => "ebay_sync_state" in u)).toBe(true);
    expect(f.updates.some((u) => u.ebay_events_synced_at === new Date(NOW).toISOString())).toBe(true);
  });

  it("at most one pass every 2 minutes", async () => {
    const f = fakeDb({ stateColumn: true, state: { lastRunAt: new Date(NOW - 60_000).toISOString(), unlinked: [] } });
    const r = await runSyncPass(f.db, "u1", { now: NOW });
    expect(r.skipped).toBe("ran recently");
    expect(trading.calls).toBe(0);
  });

  it("without migration 036 it uses the device's copy and doesn't write the column", async () => {
    trading.body = events();
    const f = fakeDb({ stateColumn: false });
    const r = await runSyncPass(f.db, "u1", { now: NOW, clientState: { lastRunAt: null, lastChangeAt: null, lastError: null, unlinked: [{ listingId: "100000009", title: "x", seenAt: "" }] } });
    expect(r.persisted).toBe(false);
    expect(r.state.unlinked.map((u) => u.listingId)).toEqual(["100000009"]);
    expect(f.updates.some((u) => "ebay_sync_state" in u)).toBe(false);
    expect(r.summary?.changed).toBe(false);
    expect(invalidateListings).not.toHaveBeenCalled();
  });

  it("an eBay error is reported, never thrown", async () => {
    trading.body = "<Ack>Failure</Ack><LongMessage>Token expired</LongMessage>";
    const f = fakeDb({ stateColumn: true });
    const r = await runSyncPass(f.db, "u1", { now: NOW });
    expect(r.skipped).toBe("eBay error");
    expect(r.state.lastError).toBe("Token expired");
  });
});
