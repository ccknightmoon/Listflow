"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

const LABELS: Record<string, string> = {
  marketing: "markdown sales & promoted listings",
  analytics: "views & impressions per listing",
  fulfillment: "order tracking",
};

/** Offers the one-tap "Reconnect eBay to unlock" for new permissions. The current connection keeps working either way. */
export function EbayPermissionsView({ missing }: { missing: string[] }) {
  if (!missing.length) return null;
  return (
    <div className="card p-3 text-xs flex flex-col gap-2" data-testid="ebay-permissions" style={{ background: "var(--accent-tint)" }}>
      <p className="font-medium text-sm">New features need one more eBay permission</p>
      <p style={{ color: "var(--text-secondary)" }}>
        Unlocks {missing.map((m) => LABELS[m] ?? m).join(", ")}. Your current connection keeps working; if you cancel on eBay&apos;s page, nothing changes.
      </p>
      <a href="/api/ebay/connect?scopes=extended" className="btn btn-primary text-xs px-3 py-1.5 self-start">Reconnect eBay to unlock</a>
    </div>
  );
}

export default function EbayPermissionsCard() {
  const [missing, setMissing] = useState<string[]>([]);
  useEffect(() => {
    apiFetch<{ connected: boolean; missingPermissions?: string[] }>("/api/ebay/connection-status")
      .then((r) => setMissing(r.connected ? r.missingPermissions ?? [] : []), () => setMissing([]));
  }, []);
  return <EbayPermissionsView missing={missing} />;
}
