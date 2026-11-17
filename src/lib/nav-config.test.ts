import { describe, it, expect } from "vitest";
import { isNavVisible, NAV_TABS, MORE_LINKS, NAV_VISIBLE_ROUTES } from "./nav-config";

describe("bottom nav visibility", () => {
  it("shows on top-level screens", () => {
    for (const r of ["/dashboard", "/drafts", "/store", "/sales", "/messages", "/offers", "/sales/"]) expect(isNavVisible(r), r).toBe(true);
  });
  it("hides on focused task screens and auth", () => {
    for (const r of ["/new-listing", "/drafts/abc-123", "/batch-upload", "/settings", "/ship", "/login", "/forgot-password", "/reset-password", "/", "/membership", "/account/pending-deletion", null]) {
      expect(isNavVisible(r as string), String(r)).toBe(false);
    }
  });
  it("bar holds at most 5 items including +, and every nav screen is reachable", () => {
    expect(NAV_TABS.length + 1 /* + */ + 1 /* More */).toBeLessThanOrEqual(5);
    const reachable = new Set([...NAV_TABS.map((t) => t.href), ...MORE_LINKS.map((t) => t.href)]);
    for (const r of NAV_VISIBLE_ROUTES) expect(reachable.has(r), r).toBe(true);
  });
});
