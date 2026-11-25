// Automatic background sync with eBay (Nov 2026). Server only.
//
// One "sync pass" asks eBay what changed since the last pass
// (GetSellerEvents, read-only, max 48 h window) and:
//   * pulls eBay-app edits into linked drafts (two-way sync, ebay-sync.ts)
//   * notices items that SOLD or ENDED, so Inventory moves them
//   * notices items that went live on eBay WITHOUT a Listflow draft
//     (listed in the eBay app) -> the "live on eBay but not linked" alert
//   * drops this seller's server caches when anything changed, so the next
//     Inventory/Home/Sales read is fresh
// Runs: every ~5 min while the app is open (EbaySyncAgent -> /api/ebay/sync),
// on app open (/api/jobs/kick), daily (snapshot cron), and every ~10 min
// from /api/cron/ebay-sync if an external scheduler is set up.
// Never writes to eBay.
import type { SupabaseClient } from "@supabase/supabase-js";
import { tradingRequest } from "@/lib/ebay-inventory";
import { syncDraftWithEbay } from "@/lib/ebay-sync";
import { TRADING_COMPAT_LEVEL } from "@/lib/trading-listing";
import { invalidateListings } from "@/lib/ebay-listings";
import { invalidateSalesFeed } from "@/lib/sales-feed-cache";
import { invalidateDashboardSummary } from "@/lib/dashboard-summary";
import { decodeEntities } from "@/lib/html-entities";

export const MAX_WINDOW_MS = 47 * 3600_000; // GetSellerEvents allows 48 h
export const MIN_INTERVAL_MS = 2 * 60_000; // never more than one pass per 2 min per seller
export const MAX_UNLINKED = 50;

export interface SellerEvent {
  itemId: string;
  title: string;
  /** Active | Completed | Ended (eBay's ListingStatusCodeType), lower-cased. */
  status: string;
  quantitySold: number;
  startTime: string | null;
}

function tag(xml: string, name: string): string {
  return xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? "";
}

/** Items in a GetSellerEvents response; null when eBay answered with an error. */
export function parseSellerEvents(xml: string): SellerEvent[] | null {
  if (!/<Ack>(Success|Warning)<\/Ack>/.test(xml)) return null;
  const out = new Map<string, SellerEvent>();
  for (const m of xml.matchAll(/<Item>([\s\S]*?)<\/Item>/g)) {
    const block = m[1];
    const itemId = tag(block, "ItemID");
    if (!/^\d{9,15}$/.test(itemId)) continue;
    const selling = tag(block, "SellingStatus");
    out.set(itemId, {
      itemId,
      title: decodeEntities(tag(block, "Title")),
      status: (tag(selling, "ListingStatus") || "Active").toLowerCase(),
      quantitySold: parseInt(tag(selling, "QuantitySold") || "0", 10) || 0,
      startTime: tag(tag(block, "ListingDetails"), "StartTime") || tag(block, "StartTime") || null,
    });
  }
  return [...out.values()];
}

export interface UnlinkedItem { listingId: string; title: string; seenAt: string }

export interface SyncState {
  lastRunAt: string | null;
  /** Last pass that changed something (sold/ended/edited/new). */
  lastChangeAt: string | null;
  lastError: string | null;
  /** Live on eBay, no Listflow draft, first seen by a sync pass. */
  unlinked: UnlinkedItem[];
}

export const EMPTY_STATE: SyncState = { lastRunAt: null, lastChangeAt: null, lastError: null, unlinked: [] };

export interface PassSummary {
  sold: string[];
  ended: string[];
  edited: number;
  conflicts: number;
  newUnlinked: UnlinkedItem[];
  changed: boolean;
}

/**
 * Pure: what the events mean for this seller. `linked` = item numbers that
 * have a Listflow draft. Unlinked items stay on the list until they get a
 * draft or stop being live; newest first, capped.
 */
export function classifyEvents(events: SellerEvent[], linked: Set<string>, prior: UnlinkedItem[], nowIso: string): { sold: string[]; ended: string[]; unlinked: UnlinkedItem[]; newUnlinked: UnlinkedItem[] } {
  const sold: string[] = [];
  const ended: string[] = [];
  const notLive = new Set<string>();
  const fresh: UnlinkedItem[] = [];
  for (const e of events) {
    const live = e.status === "active";
    if (e.quantitySold > 0) sold.push(e.itemId);
    if (!live) {
      notLive.add(e.itemId);
      if (e.quantitySold === 0) ended.push(e.itemId);
      continue;
    }
    if (!linked.has(e.itemId) && !prior.some((p) => p.listingId === e.itemId)) fresh.push({ listingId: e.itemId, title: e.title || `eBay item ${e.itemId}`, seenAt: nowIso });
  }
  const kept = prior.filter((p) => !linked.has(p.listingId) && !notLive.has(p.listingId));
  return { sold, ended, newUnlinked: fresh, unlinked: [...fresh, ...kept].slice(0, MAX_UNLINKED) };
}

export function windowStart(last: string | null | undefined, now: number): Date {
  const t = last ? Date.parse(last) : NaN;
  return new Date(Math.max(Number.isFinite(t) ? t : 0, now - MAX_WINDOW_MS));
}

export function parseState(raw: unknown): SyncState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_STATE };
  const r = raw as Partial<SyncState>;
  return {
    lastRunAt: typeof r.lastRunAt === "string" ? r.lastRunAt : null,
    lastChangeAt: typeof r.lastChangeAt === "string" ? r.lastChangeAt : null,
    lastError: typeof r.lastError === "string" ? r.lastError : null,
    unlinked: Array.isArray(r.unlinked) ? r.unlinked.filter((u) => u && typeof u.listingId === "string").slice(0, MAX_UNLINKED) : [],
  };
}

/** Saved state (migration 036). null = column missing; the client keeps its own copy then. */
export async function readSyncState(db: SupabaseClient, userId: string): Promise<{ state: SyncState; persisted: boolean; eventsSyncedAt: string | null }> {
  const full = await db.from("app_settings").select("ebay_sync_state, ebay_events_synced_at").eq("user_id", userId).maybeSingle();
  if (!full.error) return { state: parseState(full.data?.ebay_sync_state), persisted: true, eventsSyncedAt: (full.data?.ebay_events_synced_at as string | null) ?? null };
  const basic = await db.from("app_settings").select("ebay_events_synced_at").eq("user_id", userId).maybeSingle();
  return { state: { ...EMPTY_STATE }, persisted: false, eventsSyncedAt: basic.error ? null : ((basic.data?.ebay_events_synced_at as string | null) ?? null) };
}

export interface PassResult {
  state: SyncState;
  summary: PassSummary | null;
  skipped?: string;
  persisted: boolean;
}

/**
 * One sync pass. Must run inside an eBay request context (ebayContext.run).
 * `clientState` lets a seller without migration 036 keep the alert list on
 * their device; `force` skips the 2-minute guard (tests / manual refresh).
 */
export async function runSyncPass(db: SupabaseClient, userId: string, opts: { now?: number; clientState?: SyncState; force?: boolean; editLimit?: number } = {}): Promise<PassResult> {
  const now = opts.now ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const saved = await readSyncState(db, userId);
  const state = saved.persisted ? saved.state : parseState(opts.clientState);
  const last = state.lastRunAt ?? saved.eventsSyncedAt;
  if (!opts.force && last && now - Date.parse(last) < MIN_INTERVAL_MS) return { state, summary: null, skipped: "ran recently", persisted: saved.persisted };

  const from = windowStart(last, now);
  const { status, body } = await tradingRequest(
    "GetSellerEvents",
    `<?xml version="1.0" encoding="utf-8"?><GetSellerEventsRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ModTimeFrom>${from.toISOString()}</ModTimeFrom><ModTimeTo>${nowIso}</ModTimeTo><DetailLevel>ReturnSummary</DetailLevel></GetSellerEventsRequest>`,
    TRADING_COMPAT_LEVEL,
  );
  const events = status < 400 ? parseSellerEvents(body) : null;
  if (!events) {
    const msg = body.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/)?.[1] ?? `eBay answered ${status}`;
    const next = { ...state, lastError: msg.slice(0, 200) };
    await saveState(db, userId, next, saved.persisted);
    return { state: next, summary: null, skipped: "eBay error", persisted: saved.persisted };
  }

  const ids = events.map((e) => e.itemId);
  const linkedRows: Array<{ id: string; ebay_listing_id: string }> = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("drafts").select("id, ebay_listing_id").eq("user_id", userId).in("ebay_listing_id", ids.slice(i, i + 200));
    linkedRows.push(...((data ?? []) as typeof linkedRows));
  }
  // Items that already sat on the alert list may have been linked since.
  const priorIds = state.unlinked.map((u) => u.listingId).filter((id) => !ids.includes(id));
  if (priorIds.length) {
    const { data } = await db.from("drafts").select("id, ebay_listing_id").eq("user_id", userId).in("ebay_listing_id", priorIds);
    linkedRows.push(...((data ?? []) as typeof linkedRows));
  }
  const linked = new Set(linkedRows.map((r) => r.ebay_listing_id));
  const c = classifyEvents(events, linked, state.unlinked, nowIso);

  // eBay-app edits on live, linked listings (GetItem per item, capped).
  let edited = 0, conflicts = 0;
  const done = new Set([...c.sold, ...c.ended]);
  for (const r of linkedRows.filter((r) => ids.includes(r.ebay_listing_id) && !done.has(r.ebay_listing_id)).slice(0, opts.editLimit ?? 10)) {
    const s = await syncDraftWithEbay(db, userId, r.id).catch(() => null);
    if (s?.status === "updated") edited++;
    if (s?.status === "conflict") conflicts++;
  }

  const changed = events.length > 0;
  if (changed) {
    invalidateListings(userId);
    invalidateSalesFeed(userId);
    invalidateDashboardSummary(userId);
  }
  const next: SyncState = { lastRunAt: nowIso, lastChangeAt: changed ? nowIso : state.lastChangeAt, lastError: null, unlinked: c.unlinked };
  await saveState(db, userId, next, saved.persisted);
  // Keep the older sweep's bookmark in step (migration 034), so it doesn't redo this window.
  await db.from("app_settings").update({ ebay_events_synced_at: nowIso }).eq("user_id", userId);
  return { state: next, summary: { sold: c.sold, ended: c.ended, edited, conflicts, newUnlinked: c.newUnlinked, changed }, persisted: saved.persisted };
}

async function saveState(db: SupabaseClient, userId: string, state: SyncState, persisted: boolean) {
  if (!persisted) return;
  await db.from("app_settings").update({ ebay_sync_state: state }).eq("user_id", userId);
}

/** "Already linked / dismissed": drop items from the alert list. */
export function dismissUnlinked(state: SyncState, listingIds: string[]): SyncState {
  const drop = new Set(listingIds);
  return { ...state, unlinked: state.unlinked.filter((u) => !drop.has(u.listingId)) };
}
