import { describe, it, expect } from "vitest";
import { isNavVisible, NAV_TABS, MORE_LINKS, NAV_VISIBLE_ROUTES } from "./nav-config";

describe("bottom nav visibility", () => {
  it("shows on top-level screens", () => {
    for (const r of ["/dashboard", "/inventory", "/sales", "/messages", "/offers", "/sales/"]) expect(isNavVisible(r), r).toBe(true);
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

import { navModeFor, isSidebarVisible, isSidebarLinkActive, SIDEBAR_LINKS, DESKTOP_MIN_WIDTH_PX, DESKTOP_MEDIA_QUERY } from "./nav-config";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const defaultTheme = require("tailwindcss/defaultTheme");

describe("desktop layout switch", () => {
  it("switches exactly at Tailwind's lg breakpoint (so CSS lg: classes and JS agree)", () => {
    expect(defaultTheme.screens.lg).toBe(`${DESKTOP_MIN_WIDTH_PX}px`);
    expect(DESKTOP_MEDIA_QUERY).toBe("(min-width: 1024px)");
    expect(navModeFor("/dashboard", 1023)).toBe("bottom");
    expect(navModeFor("/dashboard", 1024)).toBe("sidebar");
    expect(navModeFor("/dashboard", 390)).toBe("bottom");
    expect(navModeFor("/dashboard", 1440)).toBe("sidebar");
  });
  it("keeps the phone rules below lg (task screens have no bottom bar)", () => {
    for (const r of ["/new-listing", "/drafts/abc", "/batch-upload", "/settings", "/ship"]) expect(navModeFor(r, 390), r).toBe("none");
  });
  it("shows the sidebar on every signed-in desktop screen, task screens included", () => {
    for (const r of ["/dashboard", "/inventory", "/sales", "/drafts/abc", "/new-listing", "/batch-upload", "/settings", "/ship", "/offers", "/messages", "/membership"]) {
      expect(navModeFor(r, 1280), r).toBe("sidebar");
    }
  });
  it("hides it on signed-out screens", () => {
    for (const r of ["/", "/login", "/forgot-password", "/reset-password", "/privacy", "/terms", "/account/pending-deletion", null]) {
      expect(isSidebarVisible(r as string), String(r)).toBe(false);
      expect(navModeFor(r as string, 1280)).toBe("none");
    }
  });
  it("lists every requested destination, and marks sub-routes active", () => {
    expect(SIDEBAR_LINKS.map((l) => l.label)).toEqual(["Home", "Inventory", "Sales", "Messages", "Offers", "Ship", "Business", "Settings"]);
    expect(isSidebarLinkActive("/inventory", "/drafts/123")).toBe(true);
    expect(isSidebarLinkActive("/inventory", "/store/edit/123")).toBe(true);
    expect(isSidebarLinkActive("/inventory", "/dashboard")).toBe(false);
    expect(isSidebarLinkActive("/sales", "/salesx")).toBe(false);
    expect(isSidebarLinkActive("/sales", "/sales")).toBe(true);
  });
});
