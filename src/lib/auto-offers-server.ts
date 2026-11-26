// Runs the automatic-offers planner against a seller's live data. Server only.
//
// preview (send=false): read-only eBay calls (which listings have interested
//   buyers, current prices) + DB reads. Nothing is sent, nothing is written.
// send=true: only acts when ALL are true -- env AUTO_OFFERS_ENABLED=1,
//   the seller's setting is ON, and the planner (floor/cost protected)
//   picked the item. Every attempt is logged in auto_offer_log.
import type { SupabaseClient } from "@supabase/supabase-js";
import { ebayContext, type EbayConnectionContext } from "@/lib/ebay-request-context";
import { fetchAllOfListType, isListTypeError, toListing } from "@/lib/ebay-listings";
import { fetchEligibleListingIds, sendOfferToInterestedBuyers } from "@/lib/watcher-offers";
import { autoOffersLive, planAutoOffers, settingsFromRow, type AutoOfferSettings, type OfferCandidate, type OfferPlan } from "@/lib/auto-offers";
import { isMissingRelation } from "@/lib/db-errors";

export const AUTO_OFFER_MESSAGE = "Thanks for watching — here's a special price, just for you.";

export interface AutoOfferRun {
  available: boolean;
  reason?: string;
  live: boolean;
  settings?: AutoOfferSettings;
  plan?: OfferPlan;
  sent?: number;
  failed?: number;
}

export async function readAutoOfferSettings(db: SupabaseClient, userId: string): Promise<AutoOfferSettings | null> {
  const { data, error } = await db
    .from("app_settings")
    .select("auto_offers_enabled, auto_offers_percent, auto_offers_min_days, auto_offers_all_items, auto_offers_repeat_days")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return null; // migration 042 not applied
  return settingsFromRow(data);
}

export interface AutoOfferDeps {
  /** Reads drafts/log (RLS client for previews, service client for the cron). */
  db: SupabaseClient;
  /** Writes the log (service role). Required when send=true. */
  logDb?: SupabaseClient;
  connection: EbayConnectionContext;
  now?: number;
  /** Test seam: defaults to the real eBay calls. */
  ebay?: {
    eligible(): Promise<Set<string> | null>;
    active(force: boolean): Promise<Array<{ listingId: string; title: string; price: number | null; startTime: string | null }> | null>;
    send(listingId: string, pct: number, message: string): Promise<{ ok: boolean; error?: string }>;
  };
}

const realEbay: NonNullable<AutoOfferDeps["ebay"]> = {
  eligible: () => fetchEligibleListingIds().catch(() => null),
  async active(force) {
    const r = await fetchAllOfListType("ActiveList", { force }).catch(() => null);
    if (!r || isListTypeError(r)) return null;
    return r.items.map((x) => toListing(x, "active"));
  },
  send: (id, pct, msg) => sendOfferToInterestedBuyers(id, pct, msg),
};

export async function runAutoOffers(deps: AutoOfferDeps, userId: string, opts: { send: boolean; settingsOverride?: Partial<AutoOfferSettings> }): Promise<AutoOfferRun> {
  const live = autoOffersLive();
  const now = deps.now ?? Date.now();
  const ebay = deps.ebay ?? realEbay;
  const base = await readAutoOfferSettings(deps.db, userId);
  if (!base) return { available: false, live, reason: "Automatic offers need a one-time database update (migration 042)." };
  // A preview may show "what would happen if I turned it on" (enabled forced
  // true) -- a real send never takes an override.
  const settings: AutoOfferSettings = opts.send ? base : { ...base, ...opts.settingsOverride };
  if (opts.send && (!live || !base.enabled)) {
    return { available: true, live, settings, reason: !live ? "AUTO_OFFERS_ENABLED is not 1 — preview only." : "Turned off in Settings.", sent: 0, failed: 0 };
  }

  return ebayContext.run(deps.connection, async () => {
    const eligible = await ebay.eligible();
    if (!eligible) return { available: true, live, settings, reason: "Couldn't read interested buyers from eBay (reconnect eBay if this keeps happening)." };
    if (eligible.size === 0) return { available: true, live, settings, plan: { send: [], skipped: [] }, sent: 0, failed: 0 };
    const active = await ebay.active(opts.send);
    if (!active) return { available: true, live, settings, reason: "Couldn't read your live listings from eBay." };
    const ids = active.map((a) => a.listingId).filter((id) => eligible.has(id));

    const drafts = new Map<string, Record<string, unknown>>();
    if (ids.length) {
      const { data, error } = await deps.db
        .from("drafts")
        .select("id, ebay_listing_id, best_offer_floor, cost_basis, auto_offer_opt_in, ebay_listed_at")
        .eq("user_id", userId)
        .in("ebay_listing_id", ids);
      if (error) {
        return { available: !isMissingRelation(error, "auto_offer_opt_in|best_offer_floor"), live, settings, reason: "Couldn't read your items (database update pending?)." };
      }
      for (const d of data ?? []) drafts.set(String(d.ebay_listing_id), d);
    }

    const lastSent = new Map<string, string>();
    const { data: log } = await deps.db
      .from("auto_offer_log")
      .select("ebay_listing_id, created_at")
      .eq("user_id", userId)
      .eq("status", "sent")
      .gte("created_at", new Date(now - 90 * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(5000);
    for (const l of log ?? []) if (!lastSent.has(String(l.ebay_listing_id))) lastSent.set(String(l.ebay_listing_id), String(l.created_at));

    const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
    const candidates: OfferCandidate[] = active.filter((a) => eligible.has(a.listingId)).map((a) => {
      const d = drafts.get(a.listingId);
      return {
        listingId: a.listingId,
        title: a.title,
        price: a.price,
        listedAt: a.startTime ?? (d?.ebay_listed_at as string | null) ?? null,
        draftId: (d?.id as string) ?? null,
        optIn: d?.auto_offer_opt_in === true,
        floor: num(d?.best_offer_floor),
        cost: num(d?.cost_basis),
      };
    });
    const plan = planAutoOffers(settings, candidates, eligible, lastSent, now);
    if (!opts.send) return { available: true, live, settings, plan };

    // Real send (env on + setting on, checked above).
    let sent = 0, failed = 0;
    for (const o of plan.send) {
      const r = await ebay.send(o.listingId, o.discountPercent, AUTO_OFFER_MESSAGE).catch((e: Error) => ({ ok: false, error: e.message }));
      if (r.ok) sent++; else failed++;
      await deps.logDb?.from("auto_offer_log").insert({
        user_id: userId,
        ebay_listing_id: o.listingId,
        draft_id: o.draftId,
        discount_percent: o.discountPercent,
        list_price: o.price,
        offer_price: o.offerPrice,
        floor_price: o.minAllowed,
        status: r.ok ? "sent" : "failed",
        detail: r.ok ? null : (r.error ?? "").slice(0, 500),
      });
    }
    return { available: true, live, settings, plan, sent, failed };
  });
}
