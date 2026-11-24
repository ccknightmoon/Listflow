// Two-way sync between Listflow drafts and their live eBay listings.
//
// Rule: never overwrite the newer side silently.
//  * eBay changed, Listflow didn't (since the last sync): Listflow takes
//    eBay's version.
//  * Listflow changed, eBay didn't: nothing to do until "Update on eBay".
//  * Both changed: "conflict" -- the editor asks which to keep.
// "Changed on eBay" = the listing's fingerprint (liveItemHash) differs from
// the one saved at the last sync; "changed in Listflow" = the draft was
// saved after that sync. Needs migration 034 for the saved fingerprint;
// without it, sync reports "untracked" and changes nothing.
import type { SupabaseClient } from "@supabase/supabase-js";
import { tradingRequest } from "@/lib/ebay-inventory";
import { draftFieldsFromLiveItem, getLiveItem, isEndedStatus, liveItemHash, type LiveItem } from "@/lib/ebay-item";
import { markSynced } from "@/lib/ebay-item-import";
import { TRADING_COMPAT_LEVEL } from "@/lib/trading-listing";

export type SyncStatus = "in-sync" | "baseline" | "updated" | "conflict" | "untracked" | "not-listed" | "ended" | "error";

export interface SyncDraft {
  id: string;
  ebay_listing_id: string | null;
  updated_at?: string | null;
  ebay_revision_hash?: string | null;
  ebay_synced_at?: string | null;
}

/** Saved after the last sync? (5 s slack: marking the sync itself bumps updated_at.) */
export function hasLocalEdits(d: SyncDraft): boolean {
  if (!d.ebay_synced_at || !d.updated_at) return false;
  return Date.parse(d.updated_at) - Date.parse(d.ebay_synced_at) > 5000;
}

export function decideSync(d: SyncDraft, liveHash: string, trackingAvailable: boolean): Exclude<SyncStatus, "not-listed" | "ended" | "error"> {
  if (!trackingAvailable) return "untracked";
  if (!d.ebay_revision_hash) return "baseline";
  if (d.ebay_revision_hash === liveHash) return "in-sync";
  return hasLocalEdits(d) ? "conflict" : "updated";
}

/** The fields Listflow takes from eBay when eBay's version wins (never SKU/cost/notes). */
export function fieldsFromEbay(live: LiveItem) {
  const f = draftFieldsFromLiveItem(live);
  return {
    title: f.title, brand: f.brand, color: f.color, size: f.size, condition: f.condition, flaws: f.flaws,
    suggested_price: f.suggested_price, description: f.description, photo_urls: f.photo_urls, thumbnail_url: f.thumbnail_url,
    store_category_id: f.store_category_id, item_specifics: f.item_specifics,
  };
}

export async function applyEbayVersion(db: SupabaseClient, userId: string, draftId: string, live: LiveItem): Promise<void> {
  await db.from("drafts").update(fieldsFromEbay(live)).eq("id", draftId).eq("user_id", userId);
  await markSynced(db, userId, draftId, liveItemHash(live));
}

async function loadSyncDraft(db: SupabaseClient, userId: string, draftId: string): Promise<{ draft: SyncDraft | null; tracking: boolean }> {
  const full = await db.from("drafts").select("id, ebay_listing_id, updated_at, ebay_revision_hash, ebay_synced_at").eq("id", draftId).eq("user_id", userId).maybeSingle();
  if (!full.error) return { draft: (full.data as SyncDraft) ?? null, tracking: true };
  const basic = await db.from("drafts").select("id, ebay_listing_id, updated_at").eq("id", draftId).eq("user_id", userId).maybeSingle();
  return { draft: (basic.data as SyncDraft) ?? null, tracking: false };
}

/**
 * Sync one listed draft with eBay (editor open, background sweep).
 * `useEbay` = the seller chose eBay's version in a conflict.
 */
export async function syncDraftWithEbay(
  db: SupabaseClient,
  userId: string,
  draftId: string,
  opts: { useEbay?: boolean; live?: LiveItem } = {},
): Promise<{ status: SyncStatus; hash?: string; error?: string; live?: Pick<LiveItem, "title" | "price" | "quantity" | "status"> }> {
  const { draft, tracking } = await loadSyncDraft(db, userId, draftId);
  if (!draft) return { status: "error", error: "Draft not found" };
  if (!draft.ebay_listing_id) return { status: "not-listed" };
  const live = opts.live ?? (await getLiveItem(draft.ebay_listing_id));
  if ("error" in live) return { status: "error", error: live.error };
  const hash = liveItemHash(live);
  const summary = { title: live.title, price: live.price, quantity: live.quantity, status: live.status };
  if (isEndedStatus(live.status)) return { status: "ended", hash, live: summary };
  if (opts.useEbay) {
    await applyEbayVersion(db, userId, draftId, live);
    return { status: "updated", hash, live: summary };
  }
  const decision = decideSync(draft, hash, tracking);
  if (decision === "baseline") await markSynced(db, userId, draftId, hash);
  if (decision === "updated") await applyEbayVersion(db, userId, draftId, live);
  return { status: decision, hash, live: summary };
}

// ---------- background sweep (app open + daily job) ----------

/** Item numbers eBay says changed in the window (GetSellerEvents, max 48 h). */
export async function changedItemIds(since: Date, now = new Date()): Promise<string[] | null> {
  const from = new Date(Math.max(since.getTime(), now.getTime() - 47 * 3600_000));
  const { body } = await tradingRequest(
    "GetSellerEvents",
    `<?xml version="1.0" encoding="utf-8"?><GetSellerEventsRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ModTimeFrom>${from.toISOString()}</ModTimeFrom><ModTimeTo>${now.toISOString()}</ModTimeTo><DetailLevel>ReturnSummary</DetailLevel></GetSellerEventsRequest>`,
    TRADING_COMPAT_LEVEL,
  );
  return parseSellerEventIds(body);
}

export function parseSellerEventIds(xml: string): string[] | null {
  if (!/<Ack>(Success|Warning)<\/Ack>/.test(xml)) return null;
  const ids = [...xml.matchAll(/<Item>[\s\S]*?<ItemID>(\d{9,15})<\/ItemID>/g)].map((m) => m[1]);
  return [...new Set(ids)];
}

/**
 * Pull eBay-side edits into linked drafts. At most `limit` GetItem calls a
 * run; conflicts are left for the editor to show. Needs migration 034
 * (skips quietly without it). Must run inside an eBay request context.
 */
export async function sweepEbayChanges(db: SupabaseClient, userId: string, opts: { limit?: number; now?: Date } = {}): Promise<{ checked: number; updated: number; conflicts: number; skipped?: string }> {
  const now = opts.now ?? new Date();
  const { data: settings, error } = await db.from("app_settings").select("ebay_events_synced_at").eq("user_id", userId).maybeSingle();
  if (error) return { checked: 0, updated: 0, conflicts: 0, skipped: "migration 034 not applied" };
  const last = settings?.ebay_events_synced_at ? new Date(settings.ebay_events_synced_at as string) : new Date(now.getTime() - 47 * 3600_000);
  if (now.getTime() - last.getTime() < 10 * 60_000) return { checked: 0, updated: 0, conflicts: 0, skipped: "ran recently" };
  const ids = await changedItemIds(last, now);
  if (!ids) return { checked: 0, updated: 0, conflicts: 0, skipped: "eBay error" };
  let updated = 0, conflicts = 0, checked = 0;
  if (ids.length) {
    const { data: drafts } = await db.from("drafts").select("id, ebay_listing_id").eq("user_id", userId).in("ebay_listing_id", ids.slice(0, 200));
    for (const d of (drafts ?? []).slice(0, opts.limit ?? 15)) {
      checked++;
      const r = await syncDraftWithEbay(db, userId, d.id as string).catch(() => null);
      if (r?.status === "updated") updated++;
      if (r?.status === "conflict") conflicts++;
    }
  }
  await db.from("app_settings").update({ ebay_events_synced_at: now.toISOString() }).eq("user_id", userId);
  return { checked, updated, conflicts };
}
