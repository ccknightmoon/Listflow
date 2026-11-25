"use client";

import { createContext, useContext, type ReactNode } from "react";

// Inventory (Nov 2026) shows the old Drafts / Listings / Scheduled screens
// as status filters of one page. Each view still owns its data, actions
// and caching; inside Inventory it swaps its own title row for the shared
// Inventory header (title + status filters) passed down here.
export interface InventoryEmbed {
  header: ReactNode;
  /** Listings view: which eBay list the current filter means. */
  listingsTab?: "active" | "ended";
}

export const InventoryEmbedContext = createContext<InventoryEmbed | null>(null);

export function useInventoryEmbed(): InventoryEmbed | null {
  return useContext(InventoryEmbedContext);
}
