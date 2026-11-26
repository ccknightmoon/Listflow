// Automatic offers to watchers (Phase 1). Pure planner -- no eBay, no DB.
//
// Safety rules (all enforced here, and tested):
//  * Nothing is planned unless the seller switched it on (settings.enabled).
//    The executor additionally needs Vercel env AUTO_OFFERS_ENABLED=1 to
//    actually send; otherwise it only previews.
//  * Only listings eBay says are eligible (they have interested buyers).
//  * Only items the seller opted in (or "all live items" chosen).
//  * The offer price is NEVER below the item's Best Offer floor, its cost,
//    or eBay's $0.99 minimum. If the configured % would go lower, a smaller
//    % is used; if even 5% (eBay's minimum) would go lower, it's skipped.
//  * Items with neither a floor nor a cost are skipped (no way to know the
//    lowest safe price).
//  * Not more often than every `repeatDays` per listing, and only after the
//    listing has been live `minDays`.
import { MIN_PRICE } from "@/lib/price-floor";

export const EBAY_MIN_OFFER_PERCENT = 5;
export const MAX_OFFERS_PER_RUN = 50;

export interface AutoOfferSettings {
  enabled: boolean;
  percent: number; // 5..50
  minDays: number;
  allItems: boolean;
  repeatDays: number;
}

export const AUTO_OFFER_DEFAULTS: AutoOfferSettings = { enabled: false, percent: 10, minDays: 3, allItems: false, repeatDays: 7 };

export interface OfferCandidate {
  listingId: string;
  title: string;
  /** Current price on eBay. */
  price: number | null;
  /** When the listing went live (eBay StartTime or Listflow publish time). */
  listedAt: string | null;
  draftId: string | null;
  optIn: boolean;
  floor: number | null;
  cost: number | null;
}

export type SkipReason =
  | "not_eligible"
  | "not_opted_in"
  | "too_new"
  | "sent_recently"
  | "no_price"
  | "no_floor_or_cost"
  | "at_floor";

export interface PlannedOffer {
  listingId: string;
  draftId: string | null;
  title: string;
  price: number;
  discountPercent: number;
  offerPrice: number;
  /** The lowest price allowed for this item (max of floor, cost, $0.99). */
  minAllowed: number;
  limitedBy: "floor" | "cost" | "minimum" | null;
}

export interface OfferPlan {
  send: PlannedOffer[];
  skipped: Array<{ listingId: string; title: string; reason: SkipReason }>;
}

const toC = (n: number) => Math.round(n * 100);

/**
 * Offer price for a % discount, rounded DOWN to the cent (the lowest a
 * buyer could be charged however eBay rounds), so the floor check is safe.
 */
export function offerPriceFor(price: number, percent: number): number {
  return Math.floor((toC(price) * (100 - percent)) / 100) / 100;
}

/**
 * Largest whole % (<= wanted) whose offer price stays >= minAllowed, or null
 * when even eBay's 5% minimum would go below it.
 */
export function safeDiscount(price: number, wanted: number, minAllowed: number): number | null {
  const want = Math.min(Math.max(Math.trunc(wanted), EBAY_MIN_OFFER_PERCENT), 80);
  for (let d = want; d >= EBAY_MIN_OFFER_PERCENT; d--) {
    if (toC(offerPriceFor(price, d)) >= toC(minAllowed)) return d;
  }
  return null;
}

export function minAllowedPrice(floor: number | null, cost: number | null): { min: number; by: PlannedOffer["limitedBy"] } {
  let min = MIN_PRICE;
  let by: PlannedOffer["limitedBy"] = "minimum";
  if (typeof floor === "number" && Number.isFinite(floor) && floor > min) { min = floor; by = "floor"; }
  if (typeof cost === "number" && Number.isFinite(cost) && cost > min) { min = cost; by = "cost"; }
  return { min: Math.round(min * 100) / 100, by };
}

export function planAutoOffers(
  settings: AutoOfferSettings,
  candidates: OfferCandidate[],
  eligible: Set<string>,
  lastSentAt: Map<string, string>,
  now: number,
): OfferPlan {
  const plan: OfferPlan = { send: [], skipped: [] };
  if (!settings.enabled) return plan;
  const skip = (c: OfferCandidate, reason: SkipReason) => plan.skipped.push({ listingId: c.listingId, title: c.title, reason });
  for (const c of candidates) {
    if (!eligible.has(c.listingId)) { skip(c, "not_eligible"); continue; }
    if (!c.optIn && !settings.allItems) { skip(c, "not_opted_in"); continue; }
    if (c.listedAt) {
      const ageDays = (now - Date.parse(c.listedAt)) / 86_400_000;
      if (Number.isFinite(ageDays) && ageDays < settings.minDays) { skip(c, "too_new"); continue; }
    }
    const last = lastSentAt.get(c.listingId);
    if (last && (now - Date.parse(last)) / 86_400_000 < settings.repeatDays) { skip(c, "sent_recently"); continue; }
    if (c.price == null || !Number.isFinite(c.price) || c.price <= MIN_PRICE) { skip(c, "no_price"); continue; }
    const hasFloor = typeof c.floor === "number" && Number.isFinite(c.floor) && c.floor > 0;
    const hasCost = typeof c.cost === "number" && Number.isFinite(c.cost) && c.cost > 0;
    if (!hasFloor && !hasCost) { skip(c, "no_floor_or_cost"); continue; }
    const { min, by } = minAllowedPrice(c.floor, c.cost);
    const d = safeDiscount(c.price, settings.percent, min);
    if (d == null) { skip(c, "at_floor"); continue; }
    const offerPrice = offerPriceFor(c.price, d);
    plan.send.push({
      listingId: c.listingId,
      draftId: c.draftId,
      title: c.title,
      price: c.price,
      discountPercent: d,
      offerPrice,
      minAllowed: min,
      limitedBy: d < Math.trunc(settings.percent) ? by : null,
    });
    if (plan.send.length >= MAX_OFFERS_PER_RUN) break;
  }
  return plan;
}

export const SKIP_LABELS: Record<SkipReason, string> = {
  not_eligible: "No interested buyers eBay will let you offer to right now",
  not_opted_in: "Not opted in",
  too_new: "Listed too recently",
  sent_recently: "Offer sent recently",
  no_price: "No price",
  no_floor_or_cost: "Needs a floor or cost first (so offers can't go too low)",
  at_floor: "Already at its floor/cost — even 5% off would go below it",
};

export function settingsFromRow(r: Record<string, unknown> | null | undefined): AutoOfferSettings {
  if (!r) return { ...AUTO_OFFER_DEFAULTS };
  const n = (v: unknown, d: number, lo: number, hi: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= lo && x <= hi ? Math.trunc(x) : d;
  };
  return {
    enabled: r.auto_offers_enabled === true,
    percent: n(r.auto_offers_percent, 10, 5, 50),
    minDays: n(r.auto_offers_min_days, 3, 0, 365),
    allItems: r.auto_offers_all_items === true,
    repeatDays: n(r.auto_offers_repeat_days, 7, 2, 90),
  };
}

/** The env switch that allows real sends. Anything but "1" = preview only. */
export function autoOffersLive(env: Record<string, string | undefined> = process.env): boolean {
  return env.AUTO_OFFERS_ENABLED === "1";
}
