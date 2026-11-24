// Open a live eBay listing in Listflow: find (or make) the Listflow draft
// linked to it, filled from eBay's current data. Server only; needs an
// eBay request context and the caller's Supabase client (RLS-scoped).
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftFieldsFromLiveItem, getLiveItem, liveItemHash, type LiveItem } from "@/lib/ebay-item";

export interface ImportResult {
  draftId?: string;
  created?: boolean;
  refreshed?: boolean;
  conflict?: boolean;
  error?: string;
  hash?: string;
}

/** Stores the sync bookkeeping (migration 034); harmless no-op before it's applied. */
export async function markSynced(db: SupabaseClient, userId: string, draftId: string, hash: string): Promise<void> {
  await db.from("drafts").update({ ebay_revision_hash: hash, ebay_synced_at: new Date().toISOString() }).eq("id", draftId).eq("user_id", userId);
}

export async function importLiveItem(db: SupabaseClient, userId: string, itemId: string, opts: { live?: LiveItem } = {}): Promise<ImportResult> {
  const live = opts.live ?? (await getLiveItem(itemId));
  if ("error" in live) return { error: live.error };
  const hash = liveItemHash(live);

  const { data: existing } = await db
    .from("drafts")
    .select("id")
    .eq("user_id", userId)
    .eq("ebay_listing_id", itemId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    // Already linked: the editor's sync step decides whether to refresh it.
    return { draftId: existing.id as string, created: false, hash };
  }

  const fields = draftFieldsFromLiveItem(live);
  const row = { ...fields, user_id: userId, custom_sku: live.sku && /^[A-Za-z0-9]{1,50}$/.test(live.sku) ? live.sku : null };
  let { data, error } = await db.from("drafts").insert([row]).select("id").single();
  if (error && error.code === "23505") {
    // The SKU is already used by another draft: import without it.
    ({ data, error } = await db.from("drafts").insert([{ ...row, custom_sku: null }]).select("id").single());
  }
  if (error || !data?.id) return { error: error?.message ?? "Couldn't open this listing in Listflow." };
  await markSynced(db, userId, data.id as string, hash);
  return { draftId: data.id as string, created: true, hash };
}
