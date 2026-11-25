import { describe, it, expect } from "vitest";
import { itemStatus, parseStatusParam, legacyRedirectTarget, legacyRouteStatus, inventoryHref, INVENTORY_STATUSES, STATUS_LABELS } from "./inventory-status";

describe("itemStatus: one clear status per item", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  it("no eBay item number = draft", () => {
    expect(itemStatus({}, now)).toBe("draft");
    expect(itemStatus({ ebayListingId: null, ebayScheduledFor: null }, now)).toBe("draft");
  });
  it("linked with a future start = scheduled; past start = live", () => {
    expect(itemStatus({ ebayListingId: "123456789", ebayScheduledFor: "2026-12-10T00:00:00Z" }, now)).toBe("scheduled");
    expect(itemStatus({ ebayListingId: "123456789", ebayScheduledFor: "2026-11-01T00:00:00Z" }, now)).toBe("live");
    expect(itemStatus({ ebayListingId: "123456789", ebayScheduledFor: "garbage" }, now)).toBe("live");
  });
  it("what eBay reports wins, with sold > ended > live > scheduled", () => {
    expect(itemStatus({ ebayListingId: "1", ebayState: "sold" }, now)).toBe("sold");
    expect(itemStatus({ ebayListingId: "1", ebayScheduledFor: "2027-01-01T00:00:00Z", ebayState: "active" }, now)).toBe("live");
    expect(itemStatus({ ebayState: "ended" }, now)).toBe("ended");
    expect(itemStatus({ ebayState: "scheduled" }, now)).toBe("scheduled");
  });
  it("every status has a label", () => {
    for (const s of INVENTORY_STATUSES) expect(STATUS_LABELS[s]).toBeTruthy();
  });
});

describe("routes", () => {
  it("parses the filter, defaulting to Draft", () => {
    expect(parseStatusParam("sold")).toBe("sold");
    expect(parseStatusParam("nope")).toBe("draft");
    expect(parseStatusParam(null)).toBe("draft");
  });
  it("old pages forward to the matching filter", () => {
    expect(legacyRouteStatus("/drafts")).toBe("draft");
    expect(legacyRouteStatus("/store/")).toBe("live");
    expect(legacyRouteStatus("/store/scheduled")).toBe("scheduled");
    expect(legacyRouteStatus("/drafts/abc")).toBeNull();
    expect(legacyRedirectTarget("/store", { tab: "ended" })).toBe("/inventory?status=ended");
    expect(legacyRedirectTarget("/drafts")).toBe(inventoryHref("draft"));
    expect(legacyRedirectTarget("/drafts", { filter: "needs-price" })).toBe("/inventory?status=draft&filter=needs-price");
    expect(legacyRedirectTarget("/store", { filter: "stale" })).toBe("/inventory?status=live&filter=stale");
    expect(legacyRedirectTarget("/drafts", { filter: "<script>" })).toBe("/inventory?status=draft");
  });
});
