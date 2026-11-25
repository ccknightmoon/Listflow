// ONE place that decides where the bottom nav (with the centre "+") shows.
// Top-level screens get it; focused task screens (New Listing, draft
// editor, Batch Upload, Settings, Ship, auth, etc.) don't -- they have a
// back button and full-screen content instead.
//
// To change where the nav appears, edit NAV_VISIBLE_ROUTES only.
export const NAV_VISIBLE_ROUTES = ["/dashboard", "/inventory", "/sales", "/messages", "/offers"] as const;

/** Exact match only: "/drafts" shows the nav, "/drafts/123" (the editor) doesn't. */
export function isNavVisible(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (NAV_VISIBLE_ROUTES as readonly string[]).includes(p);
}

// The bar itself: at most 5 slots including "+". Everything else lives
// under "More" (or the "+" sheet, which already has Drafts).
export const NAV_TABS = [
  { href: "/dashboard", label: "Home" },
  { href: "/inventory", label: "Inventory" },
  // centre "+" goes here
  { href: "/sales", label: "Sales" },
] as const;

export const MORE_LINKS = [
  { href: "/messages", label: "Messages" },
  { href: "/offers", label: "Offers" },
  { href: "/ship", label: "Ship orders" },
  { href: "/settings", label: "Settings" },
] as const;

// ---------------------------------------------------------------------------
// Desktop (Nov 2026). From the `lg` breakpoint up, a left sidebar replaces
// the bottom bar and shows on EVERY signed-in screen (task screens too --
// on a computer there's room, and it's how websites work). Below `lg` the
// phone layout above is unchanged.

/** Tailwind's `lg` breakpoint. Desktop layout starts here. */
export const DESKTOP_MIN_WIDTH_PX = 1024;
export const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH_PX}px)`;
/** Width the sidebar reserves on the left of every desktop page. */
export const SIDEBAR_WIDTH_PX = 240;

/** Signed-out / standalone screens: no sidebar even on desktop. */
export const SIDEBAR_HIDDEN_ROUTES = ["/", "/login", "/forgot-password", "/reset-password", "/account/pending-deletion", "/privacy", "/terms"] as const;

export function isSidebarVisible(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return !(SIDEBAR_HIDDEN_ROUTES as readonly string[]).includes(p);
}

/** Sidebar order. "+ New listing" is a separate, prominent button above these. */
export const SIDEBAR_LINKS = [
  { href: "/dashboard", label: "Home" },
  { href: "/inventory", label: "Inventory" },
  { href: "/sales", label: "Sales" },
  { href: "/messages", label: "Messages" },
  { href: "/offers", label: "Offers" },
  { href: "/ship", label: "Ship" },
  { href: "/settings", label: "Settings" },
] as const;

/** Sidebar link is "current" on its own route and its sub-routes (Drafts on /drafts/123). */
// Inventory also owns the draft editor and the eBay listing editor/opener.
const ALSO_ACTIVE: Record<string, string[]> = { "/inventory": ["/drafts", "/store"] };

export function isSidebarLinkActive(href: string, pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  return under(href) || (ALSO_ACTIVE[href] ?? []).some(under);
}

export type NavMode = "bottom" | "sidebar" | "none";

/** Which navigation a screen gets at a given viewport width. */
export function navModeFor(pathname: string | null | undefined, viewportWidth: number): NavMode {
  if (viewportWidth >= DESKTOP_MIN_WIDTH_PX) return isSidebarVisible(pathname) ? "sidebar" : "none";
  return isNavVisible(pathname) ? "bottom" : "none";
}
