import { afterEach, describe, expect, it, vi } from "vitest";
import { runAutoOffers } from "./auto-offers-server";
import { fakeDb } from "@/test/fake-db";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const connection = { userId: "u", ebayUserId: null, refreshToken: "r", policies: {} };

function setup(settings: Record<string, unknown> | null) {
  const { db, inserts } = fakeDb({
    app_settings: settings ? [{ user_id: "u", ...settings }] : { error: { code: "42703", message: "column auto_offers_enabled does not exist" } },
    drafts: [
      { id: "d1", user_id: "u", ebay_listing_id: "111111", best_offer_floor: 30, cost_basis: 5, auto_offer_opt_in: true, ebay_listed_at: "2026-11-01T00:00:00Z" },
      { id: "d2", user_id: "u", ebay_listing_id: "222222", best_offer_floor: null, cost_basis: null, auto_offer_opt_in: true, ebay_listed_at: "2026-11-01T00:00:00Z" },
    ],
    auto_offer_log: [],
  });
  const send = vi.fn(async () => ({ ok: true }));
  const ebay = {
    eligible: async () => new Set(["111111", "222222"]),
    active: async () => [
      { listingId: "111111", title: "Tee", price: 40, startTime: "2026-11-01T00:00:00Z" },
      { listingId: "222222", title: "Hat", price: 20, startTime: "2026-11-01T00:00:00Z" },
    ],
    send,
  };
  return { deps: { db, logDb: db, connection, now: NOW, ebay }, send, inserts };
}

afterEach(() => vi.unstubAllEnvs());

describe("runAutoOffers", () => {
  it("without migration 042: says so, sends nothing", async () => {
    const { deps, send } = setup(null);
    const r = await runAutoOffers(deps, "u", { send: true });
    expect(r.available).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it("preview never sends or logs, even with env + setting on", async () => {
    vi.stubEnv("AUTO_OFFERS_ENABLED", "1");
    const { deps, send, inserts } = setup({ auto_offers_enabled: true, auto_offers_percent: 15 });
    const r = await runAutoOffers(deps, "u", { send: false });
    expect(r.plan?.send.map((s) => [s.listingId, s.discountPercent, s.offerPrice])).toEqual([["111111", 15, 34]]);
    expect(r.plan?.skipped.map((s) => s.reason)).toEqual(["no_floor_or_cost"]);
    expect(send).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });
  it("preview can show 'if turned on' while the setting is off", async () => {
    const { deps, send } = setup({ auto_offers_enabled: false });
    const r = await runAutoOffers(deps, "u", { send: false, settingsOverride: { enabled: true } });
    expect(r.plan?.send).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });
  it("send without the env switch does nothing", async () => {
    const { deps, send } = setup({ auto_offers_enabled: true });
    const r = await runAutoOffers(deps, "u", { send: true });
    expect(r.live).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it("send with env on but setting off does nothing (override ignored)", async () => {
    vi.stubEnv("AUTO_OFFERS_ENABLED", "1");
    const { deps, send } = setup({ auto_offers_enabled: false });
    await runAutoOffers(deps, "u", { send: true, settingsOverride: { enabled: true } });
    expect(send).not.toHaveBeenCalled();
  });
  it("send with env + setting on: sends the safe offer and logs it", async () => {
    vi.stubEnv("AUTO_OFFERS_ENABLED", "1");
    const { deps, send, inserts } = setup({ auto_offers_enabled: true, auto_offers_percent: 40 });
    const r = await runAutoOffers(deps, "u", { send: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("111111", 25, expect.any(String)); // 40% capped to stay >= $30 floor
    expect(r.sent).toBe(1);
    expect(inserts[0].row).toMatchObject({ ebay_listing_id: "111111", status: "sent", discount_percent: 25, offer_price: 30, floor_price: 30 });
  });
});
