// Records "this draft is now on eBay as item N" -- the single fact that
// moves a draft out of Drafts and into Listings/Scheduled.
//
// Both publish paths used to fire this update and ignore the answer. If it
// failed (a blip, a timeout right after eBay accepted the listing), the item
// was live on eBay but still showed as a draft, and listing it again from
// there made a duplicate. Now the write is checked, retried, and verified;
// if it still can't be saved the caller is told, and the Drafts reconcile
// step (draft-reconcile.ts) can repair it later from eBay's own list.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface LinkOutcome {
  ok: boolean;
  attempts: number;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function saveListingLink(
  db: SupabaseClient,
  userId: string,
  draftId: string,
  itemId: string,
  extra: Record<string, unknown> = {},
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<LinkOutcome> {
  const max = opts.attempts ?? 3;
  let lastError = "";
  for (let attempt = 1; attempt <= max; attempt++) {
    const { data, error } = await db
      .from("drafts")
      .update({ ebay_listing_id: itemId, ...extra })
      .eq("id", draftId)
      .eq("user_id", userId)
      .select("id, ebay_listing_id")
      .maybeSingle();
    if (!error && data && String(data.ebay_listing_id) === itemId) {
      // Separate best-effort write (column from migration 026).
      await db.from("drafts").update({ ebay_listed_at: new Date().toISOString() }).eq("id", draftId).eq("user_id", userId);
      return { ok: true, attempts: attempt };
    }
    lastError = error?.message ?? (data ? "saved value didn't match" : "draft not found");
    if (!error && !data) break; // the draft is gone: retrying can't help
    if (attempt < max) await sleep((opts.delayMs ?? 300) * attempt);
  }
  console.error(`[listing-link] draft ${draftId} is live on eBay as ${itemId} but the link wasn't saved: ${lastError}`);
  return { ok: false, attempts: max, error: lastError };
}
