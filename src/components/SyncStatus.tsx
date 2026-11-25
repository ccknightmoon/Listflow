"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { dismissUnlinkedItems, getServerSyncSnapshot, getSyncSnapshot, subscribeSync, syncedAgo, syncNow } from "@/lib/ebay-sync-client";

function useSync() {
  return useSyncExternalStore(subscribeSync, getSyncSnapshot, getServerSyncSnapshot);
}

/** Re-render every 30 s so "X min ago" stays true. */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// "Synced with eBay 3 min ago ⟳" -- tap to sync now.
export function SyncIndicator({ className = "" }: { className?: string }) {
  const s = useSync();
  const now = useNow();
  if (s.connected === false) return null;
  const ago = syncedAgo(s.state?.lastRunAt, now);
  const label = s.syncing ? "Syncing with eBay…" : s.error && s.error !== "offline" ? "eBay sync paused — will retry" : ago ? `Synced with eBay ${ago}` : "Not synced with eBay yet";
  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      disabled={s.syncing}
      className={`inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] ${className}`}
      title={s.error && s.error !== "offline" ? s.error : "Listflow checks eBay every few minutes. Tap to check now."}
      aria-live="polite"
    >
      <RefreshCw className={`w-3 h-3 ${s.syncing ? "animate-spin" : ""}`} />
      {label}
    </button>
  );
}

// "2 items are live on eBay but not in Listflow" (listed in the eBay app).
export function UnlinkedAlert() {
  const s = useSync();
  const items = s.state?.unlinked ?? [];
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="card p-3 mb-3 text-sm" style={{ borderColor: "var(--warning-border)", background: "var(--warning-bg)" }} role="status">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--warning, #b7791f)" }} />
        <div className="flex-1 min-w-0">
          <p className="font-medium">
            {items.length === 1 ? "1 item is live on eBay but not in Listflow" : `${items.length} items are live on eBay but not in Listflow`}
          </p>
          <p className="text-xs text-[var(--text-secondary)]">Probably listed in the eBay app. Bring it into Listflow to track it, or dismiss.</p>
          {open && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {items.map((u) => (
                <li key={u.listingId} className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate">{u.title}</span>
                  <Link href={`/store/edit/${u.listingId}`} className="btn text-xs">Bring into Listflow</Link>
                  <button type="button" aria-label="Dismiss" className="btn text-xs" onClick={() => void dismissUnlinkedItems([u.listingId])}><X className="w-3.5 h-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex gap-3 text-xs">
            <button type="button" className="underline" style={{ color: "var(--accent)" }} onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Review"}</button>
            <button type="button" className="underline text-[var(--text-secondary)]" onClick={() => void dismissUnlinkedItems(items.map((i) => i.listingId))}>Dismiss all</button>
          </div>
        </div>
      </div>
    </div>
  );
}
