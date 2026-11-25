"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { parseStatusParam, type InventoryStatus } from "@/lib/inventory-status";
import { InventoryEmbedContext } from "@/components/inventory/InventoryEmbed";
import InventoryHeader from "@/components/inventory/InventoryHeader";
import { SyncIndicator, UnlinkedAlert } from "@/components/SyncStatus";
import DraftsView from "@/components/inventory/DraftsView";
import ListingsView from "@/components/inventory/ListingsView";
import ScheduledView from "@/components/inventory/ScheduledView";
import SoldView from "@/components/inventory/SoldView";

// One Inventory screen (Nov 2026): Draft · Scheduled · Live · Sold · Ended.
// Replaces the separate Drafts and Listings screens (their old URLs
// forward here). Each filter reuses that screen's own view, data and
// actions; only the title row is shared.
function InventoryInner() {
  const status: InventoryStatus = parseStatusParam(useSearchParams().get("status"));
  const header = (
    <InventoryHeader
      status={status}
      extra={<><SyncIndicator className="mb-2" /><UnlinkedAlert /></>}
    />
  );
  const view =
    status === "draft" ? <DraftsView /> :
    status === "scheduled" ? <ScheduledView /> :
    status === "sold" ? <SoldView /> :
    <ListingsView />;
  return (
    <InventoryEmbedContext.Provider value={{ header, listingsTab: status === "ended" ? "ended" : "active" }}>
      {/* key: a fresh view per filter (Live/Ended repaint from the listings cache). */}
      <div key={status}>{view}</div>
    </InventoryEmbedContext.Provider>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={null}>
      <InventoryInner />
    </Suspense>
  );
}
