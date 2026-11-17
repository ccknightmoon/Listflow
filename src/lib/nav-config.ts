// ONE place that decides where the bottom nav (with the centre "+") shows.
// Top-level screens get it; focused task screens (New Listing, draft
// editor, Batch Upload, Settings, Ship, auth, etc.) don't -- they have a
// back button and full-screen content instead.
//
// To change where the nav appears, edit NAV_VISIBLE_ROUTES only.
export const NAV_VISIBLE_ROUTES = ["/dashboard", "/drafts", "/store", "/sales", "/messages", "/offers"] as const;

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
  { href: "/store", label: "Listings" },
  // centre "+" goes here
  { href: "/sales", label: "Sales" },
] as const;

export const MORE_LINKS = [
  { href: "/drafts", label: "Drafts" },
  { href: "/messages", label: "Messages" },
  { href: "/offers", label: "Offers" },
  { href: "/ship", label: "Ship orders" },
  { href: "/settings", label: "Settings" },
] as const;
