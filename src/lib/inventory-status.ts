// One clear status per item (Inventory screen, Nov 2026).
//
// Listflow used to split items across Drafts (unpublished rows), Listings
// (live/ended on eBay) and a separate Scheduled page. Inventory is one
// screen with status filters; this module is the single place that decides
// which status an item is in, so the badge, the filter and the counts can
// never disagree.
//
//   draft      in Listflow only, not on eBay yet
//   scheduled  on eBay but not live yet ("Finish on eBay" = scheduled listing)
//   live       active on eBay
//   sold       sold on eBay
//   ended      ended on eBay without selling (can be relisted)
//
// Precedence when signals overlap: sold > ended > live > scheduled > draft.
// A sale is final; an ended listing can't be live; a scheduled listing
// whose start time has passed is live.

export const INVENTORY_STATUSES = ["draft", "scheduled", "live", "sold", "ended"] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export const STATUS_LABELS: Record<InventoryStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  live: "Live",
  sold: "Sold",
  ended: "Ended",
};

export const STATUS_HINTS: Record<InventoryStatus, string> = {
  draft: "In Listflow only — not on eBay yet",
  scheduled: "On eBay, waiting to go live",
  live: "Active on eBay",
  sold: "Sold on eBay in the last 90 days",
  ended: "Ended on eBay without selling",
};

export const DEFAULT_STATUS: InventoryStatus = "draft";

export function parseStatusParam(v: string | null | undefined): InventoryStatus {
  return (INVENTORY_STATUSES as readonly string[]).includes(v ?? "") ? (v as InventoryStatus) : DEFAULT_STATUS;
}

export function inventoryHref(status: InventoryStatus, filter?: string | null): string {
  return `/inventory?status=${status}${filter ? `&filter=${encodeURIComponent(filter)}` : ""}`;
}

export interface StatusSignals {
  /** eBay item number saved on the draft (published or linked). */
  ebayListingId?: string | null;
  /** "Finish on eBay": when the scheduled listing goes live (migration 034). */
  ebayScheduledFor?: string | null;
  /** What eBay itself reported, when known (store / scheduled / sales feeds). */
  ebayState?: "active" | "scheduled" | "ended" | "sold" | null;
}

export function itemStatus(s: StatusSignals, now = Date.now()): InventoryStatus {
  if (s.ebayState === "sold") return "sold";
  if (s.ebayState === "ended") return "ended";
  if (s.ebayState === "active") return "live";
  if (s.ebayState === "scheduled") return "scheduled";
  if (!s.ebayListingId) return "draft";
  if (s.ebayScheduledFor) {
    const at = Date.parse(s.ebayScheduledFor);
    if (Number.isFinite(at) && at > now) return "scheduled";
  }
  return "live";
}

/** Old routes keep working: they forward to the matching Inventory filter. */
export function legacyRouteStatus(pathname: string): InventoryStatus | null {
  const p = pathname.replace(/\/+$/, "");
  if (p === "/drafts") return "draft";
  if (p === "/store") return "live";
  if (p === "/store/scheduled") return "scheduled";
  return null;
}

/** Carry the old page's meaning over (e.g. /store?tab=ended -> Ended). */
export function legacyRedirectTarget(pathname: string, search: Record<string, string | string[] | undefined> = {}): string {
  let status = legacyRouteStatus(pathname) ?? DEFAULT_STATUS;
  if (status === "live" && search.tab === "ended") status = "ended";
  // Deep-link filters (Needs attention: ?filter=needs-price / stale) still work.
  const filter = typeof search.filter === "string" && /^[a-z-]{1,24}$/.test(search.filter) ? search.filter : null;
  return inventoryHref(status, filter);
}
