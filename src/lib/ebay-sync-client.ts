// Browser side of the background eBay sync (see src/lib/ebay-auto-sync.ts).
// One tiny store shared by the app-wide EbaySyncAgent (runs the passes),
// the "Synced with eBay X min ago" indicator and the "not in Listflow"
// alert. When a pass finds changes it fires EBAY_CHANGED_EVENT so open
// screens (Inventory, Home) reload quietly.
import type { SyncState, PassSummary } from "@/lib/ebay-auto-sync";

export const EBAY_CHANGED_EVENT = "listflow:ebay-changed";
export const SYNC_EVERY_MS = 5 * 60_000;
const KEY = "listflow:ebay-sync:v1";

export interface ClientSync {
  state: SyncState | null;
  syncing: boolean;
  connected: boolean | null;
  error: string | null;
}

let current: ClientSync = { state: null, syncing: false, connected: null, error: null };
const listeners = new Set<() => void>();

function emit(next: Partial<ClientSync>) {
  current = { ...current, ...next };
  for (const l of listeners) l();
}

export function subscribeSync(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function getSyncSnapshot(): ClientSync {
  return current;
}
const SERVER_SNAPSHOT: ClientSync = { state: null, syncing: false, connected: null, error: null };
export function getServerSyncSnapshot(): ClientSync {
  return SERVER_SNAPSHOT;
}

export function loadSavedState(): void {
  if (current.state) return;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) emit({ state: JSON.parse(raw) as SyncState });
  } catch {
    // storage blocked: indicator just starts empty
  }
}

function save(state: SyncState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

let inFlight: Promise<void> | null = null;

/** Run one pass now (the server skips it if one ran < 2 min ago). */
export function syncNow(): Promise<void> {
  if (inFlight) return inFlight;
  emit({ syncing: true });
  inFlight = (async () => {
    try {
      const res = await fetch("/api/ebay/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientState: current.state }) });
      if (res.status === 401) { emit({ syncing: false }); return; }
      const data = (await res.json()) as { connected?: boolean; state?: SyncState; summary?: PassSummary | null; error?: string; skipped?: string };
      if (data.connected === false) { emit({ syncing: false, connected: false }); return; }
      if (data.state) save(data.state);
      emit({ syncing: false, connected: true, state: data.state ?? current.state, error: data.error ?? (data.skipped === "eBay error" ? data.state?.lastError ?? "eBay didn't answer" : null) });
      if (data.summary?.changed && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(EBAY_CHANGED_EVENT, { detail: data.summary }));
      }
    } catch {
      emit({ syncing: false, error: "offline" });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export async function dismissUnlinkedItems(listingIds: string[]): Promise<void> {
  if (current.state) {
    const state = { ...current.state, unlinked: current.state.unlinked.filter((u) => !listingIds.includes(u.listingId)) };
    save(state);
    emit({ state });
  }
  await fetch("/api/ebay/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dismiss: listingIds, clientState: current.state }) }).catch(() => {});
}

/** Reload a screen when the background sync saw eBay changes. */
export function onEbayChanged(fn: (s: PassSummary) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<PassSummary>).detail);
  window.addEventListener(EBAY_CHANGED_EVENT, h);
  return () => window.removeEventListener(EBAY_CHANGED_EVENT, h);
}

/** "just now" / "4 min ago" / "2 h ago" / "3 days ago". */
export function syncedAgo(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** Next pass due? (visible tab, every 5 min, or the last one is old). */
export function shouldSync(lastRunAt: string | null | undefined, now = Date.now(), every = SYNC_EVERY_MS): boolean {
  if (!lastRunAt) return true;
  const t = Date.parse(lastRunAt);
  return !Number.isFinite(t) || now - t >= every;
}
