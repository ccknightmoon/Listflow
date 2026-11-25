"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isSidebarVisible } from "@/lib/nav-config";
import { getSyncSnapshot, loadSavedState, shouldSync, syncNow, SYNC_EVERY_MS } from "@/lib/ebay-sync-client";

// App-wide: keeps Listflow in step with eBay while the app is open. Runs a
// sync pass on open, every 5 minutes while the tab is visible, and when
// the app comes back to the foreground. Signed-in screens only; renders
// nothing.
export default function EbaySyncAgent() {
  const pathname = usePathname();
  const signedIn = isSidebarVisible(pathname);
  useEffect(() => {
    if (!signedIn) return;
    loadSavedState();
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (shouldSync(getSyncSnapshot().state?.lastRunAt, Date.now(), SYNC_EVERY_MS - 15_000)) void syncNow();
    };
    tick();
    const t = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [signedIn]);
  return null;
}
