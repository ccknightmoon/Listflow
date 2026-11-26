// Publishing and in-place revising through the Trading API (server only).
// Builds on src/lib/trading-listing.ts (pure XML). Used by publishDraft()
// when PUBLISH_API is "trading" (the default).
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { tradingRequest, inventoryRequest, getConditionCandidates, getSafeFallbackCategory } from "@/lib/ebay-inventory";
import { fetchAspectDefs, fetchAllowedConditions } from "@/lib/ebay-aspects";
import { buildPublishAspects } from "@/lib/publish-aspects";
import { conditionNote, fitTitle, isTemplateHtml, listingDescriptionHtml, pickCondition, sanitizeStoredSpecifics } from "@/lib/item-specifics";
import type { LiveItem } from "@/lib/ebay-item";
import { finalizeListingDescription, removeIntroFromPlainText, type DescriptionPrefs } from "@/lib/store-intro";
import { buildPackageWeightAndSize } from "@/lib/shipping";
import { createTtlDedupeCache } from "@/lib/ttl-cache";
import { saveListingLink } from "@/lib/listing-link";
import { bestOfferTerms } from "@/lib/offer-floor";
import {
  buildTradingItemXml, tradingRequestXml, parseTradingResponse, duplicateUuidItemId, isPackageError, isConditionError,
  isCategoryError, isInventoryModelError, isBestOfferError, describeTradingErrors, listingUuid, listingPostalCode, scheduleTimeFromNow,
  CONDITION_ENUM_TO_ID, TRADING_COMPAT_LEVEL, type TradingItemInput, type TradingResult,
} from "@/lib/trading-listing";

export type TradingCall = "AddFixedPriceItem" | "VerifyAddFixedPriceItem" | "ReviseFixedPriceItem";

export async function tradingItemCall(call: TradingCall, item: TradingItemInput): Promise<TradingResult> {
  const { body } = await tradingRequest(call, tradingRequestXml(call, buildTradingItemXml(item)), TRADING_COMPAT_LEVEL);
  return parseTradingResponse(body);
}

// ---------- the seller's return + payment business policies ----------
interface Profiles { returnProfileId: string | null; paymentProfileId: string | null }
const profileCache = createTtlDedupeCache<Profiles | null>();

function pickDefault<T extends { categoryTypes?: Array<{ default?: boolean }> }>(list: T[]): T | undefined {
  return list.find((p) => p.categoryTypes?.some((c) => c.default)) ?? list[0];
}

export async function loadSellerProfiles(userId: string, savedReturnId: string | null | undefined): Promise<Profiles> {
  const fetched = await profileCache.get(userId, 10 * 60_000, async () => {
    try {
      const [ret, pay] = await Promise.all([
        inventoryRequest("GET", "/sell/account/v1/return_policy?marketplace_id=EBAY_US"),
        inventoryRequest("GET", "/sell/account/v1/payment_policy?marketplace_id=EBAY_US"),
      ]);
      const returns = ret.status < 400 ? ((ret.data as { returnPolicies?: Array<{ returnPolicyId: string; categoryTypes?: Array<{ default?: boolean }> }> }).returnPolicies ?? []) : [];
      const payments = pay.status < 400 ? ((pay.data as { paymentPolicies?: Array<{ paymentPolicyId: string; categoryTypes?: Array<{ default?: boolean }> }> }).paymentPolicies ?? []) : [];
      return { returnProfileId: pickDefault(returns)?.returnPolicyId ?? null, paymentProfileId: pickDefault(payments)?.paymentPolicyId ?? null };
    } catch {
      return null;
    }
  }, (v) => v !== null);
  return { returnProfileId: savedReturnId || fetched?.returnProfileId || null, paymentProfileId: fetched?.paymentProfileId ?? null };
}

// ---------- draft -> Trading item ----------
export type DraftRow = Record<string, unknown> & {
  id: string;
  title: string | null;
  condition: string | null;
  flaws: string | null;
  suggested_price: number;
  photo_urls?: string[] | null;
  thumbnail_url: string | null;
  item_type?: string | null;
  size?: string | null;
  material?: string | null;
  custom_sku?: string | null;
  store_category_id?: string | null;
  ebay_listing_id?: string | null;
  /** Migration 035; absent before it's applied. */
  best_offer_floor?: number | string | null;
};

/**
 * Best Offer for a draft: on with auto-decline below the floor when a valid
 * floor is saved. With no floor: off for a new listing, untouched on a
 * revise (so Best Offer set up in the eBay app isn't switched off).
 */
export function draftBestOffer(draft: Pick<DraftRow, "suggested_price" | "best_offer_floor">, mode: "add" | "revise"): TradingItemInput["bestOffer"] {
  const terms = bestOfferTerms(Number(draft.suggested_price), draft.best_offer_floor);
  if (terms.enabled) return { enabled: true, autoDecline: terms.autoDecline };
  return mode === "add" ? { enabled: false } : undefined;
}

export function draftPictureUrls(d: Pick<DraftRow, "photo_urls" | "thumbnail_url">): string[] {
  const urls = (d.photo_urls ?? []).filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));
  if (urls.length === 0 && d.thumbnail_url && /^https?:\/\//.test(d.thumbnail_url)) urls.push(d.thumbnail_url);
  // eBay only fetches self-hosted pictures over https.
  return urls.map((u) => u.replace(/^http:\/\//, "https://")).slice(0, 24);
}

/** HTML that isn't Listflow's own template (e.g. imported from an eBay-made listing). */
export function isForeignHtml(desc: unknown): desc is string {
  return typeof desc === "string" && /<[a-z][^>]*>/i.test(desc) && !isTemplateHtml(desc);
}

/**
 * Item specifics eBay accepts on a listing but that aren't in the
 * category's list ("custom" specifics, common on eBay-made listings) are
 * dropped by the usual category validation. On a revise, keep the ones the
 * live listing already has AND the seller still has in the draft.
 */
export function keepCustomSpecifics(built: Record<string, string[]>, stored: Record<string, string[]> | undefined, live: Record<string, string[]> | undefined): Record<string, string[]> {
  if (!stored || !live) return built;
  const have = new Set(Object.keys(built).map((k) => k.toLowerCase()));
  const liveNames = new Set(Object.keys(live).map((k) => k.toLowerCase()));
  const out = { ...built };
  for (const [name, values] of Object.entries(stored)) {
    const k = name.toLowerCase();
    if (!have.has(k) && liveNames.has(k) && values.length) out[name] = values;
  }
  return out;
}

export interface BuiltItem {
  item: TradingItemInput;
  conditionIds: number[];
  missingRequired: string[];
  /** List-only values eBay would reject (see buildPublishAspects). */
  rejected: Array<{ name: string; value: string; options: string[] }>;
}

/**
 * "… Size 9 Beige" → "… Size 9 (4XL) Beige" when the tag size was converted
 * to eBay's size (brand sizing), so buyers see both. Only if it still fits
 * in eBay's 80 characters; otherwise the title is unchanged.
 */
export function titleWithMappedSize(title: string, tagSize: string | null | undefined, ebaySize: string | null, note: string | null): string {
  const tag = (tagSize ?? "").trim();
  if (!note || !tag || !ebaySize || tag.toLowerCase() === ebaySize.toLowerCase()) return title;
  // Only brand sizing ("Lacoste size 9 = 4XL"), not spelling fixes (XXL → 2XL).
  if (!/\bsize \d+ = /i.test(note) || /^tag size/i.test(note)) return title;
  if (new RegExp(`\\(${ebaySize.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`, "i").test(title)) return title;
  const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b(size|sz)\\s+${esc}\\b`, "i");
  const m = title.match(re);
  if (!m) return title;
  const next = title.replace(re, `${m[0]} (${ebaySize})`);
  return next.length <= 80 ? next : title;
}

/** Plain-English pre-flight error for values eBay would reject, or null. */
export function rejectedValuesError(rejected: BuiltItem["rejected"]): string | null {
  if (!rejected.length) return null;
  return rejected
    .map((r) => `"${r.value}" is not a valid value for ${r.name}. Pick one of eBay's values${r.options.length ? ` (e.g. ${r.options.slice(0, 6).join(", ")})` : ""}.`)
    .join(" · ");
}

export async function buildItemForDraft(draft: DraftRow, opts: { categoryId: string; sku: string; storeFooter: string | null; descPrefs?: DescriptionPrefs | null; packageTyped?: boolean }): Promise<BuiltItem> {
  const defs = await fetchAspectDefs(opts.categoryId);
  const { aspects, missingRequired, measurements, rejected, sizeNote } = buildPublishAspects(draft as never, defs);
  const allowed = await fetchAllowedConditions(opts.categoryId);
  const preferred = pickCondition(draft.condition, allowed);
  const enums = [...new Set([preferred, ...getConditionCandidates(draft.condition, draft.title || "")].filter((x): x is string => !!x))];
  const conditionIds = enums.map((e) => CONDITION_ENUM_TO_ID[e]).filter((n): n is number => !!n);
  const pkg = buildPackageWeightAndSize(draft.item_type, draft.size, draft.material, opts.packageTyped === false ? "untyped" : "typed", draft.title);
  const weightOz = pkg.weight.unit === "OUNCE" ? pkg.weight.value : pkg.weight.value * 16;
  return {
    conditionIds,
    missingRequired,
    rejected,
    item: {
      title: titleWithMappedSize(fitTitle(draft.title) || "Item", draft.size, aspects["Size"]?.[0] ?? null, sizeNote),
      // A description brought in from an eBay-made listing (its own HTML) is
      // sent back as-is; Listflow drafts get the usual generated layout.
      // Settings → Store intro goes on top and "Measurements: see photos"
      // swaps the measurement list, both at build time (idempotent, never
      // saved into the draft) -- see src/lib/store-intro.ts.
      descriptionHtml: finalizeListingDescription(
        isForeignHtml(draft.description)
          ? String(draft.description)
          : listingDescriptionHtml({ ...draft, description: removeIntroFromPlainText(draft.description as string | null | undefined, opts.descPrefs?.storeIntro ?? null) } as never, aspects, measurements, opts.storeFooter, sizeNote),
        opts.descPrefs,
      ),
      categoryId: opts.categoryId,
      conditionId: conditionIds[0],
      conditionDescription: conditionNote(draft.condition, draft.flaws),
      aspects,
      pictureUrls: draftPictureUrls(draft),
      price: Number(draft.suggested_price),
      quantity: 1,
      sku: opts.sku,
      package: { weightOz, lengthIn: pkg.dimensions.length, widthIn: pkg.dimensions.width, heightIn: pkg.dimensions.height, packageType: "packageType" in pkg ? (pkg as { packageType?: string }).packageType : undefined },
      storeCategoryId: draft.store_category_id ? String(draft.store_category_id) : null,
      bestOffer: draftBestOffer(draft, draft.ebay_listing_id ? "revise" : "add"),
    },
  };
}

/**
 * Verify, adjusting the few things eBay commonly rejects, the same way the
 * Inventory path retried: the package type (drop it), the condition (the
 * other spelling of the SAME tier, never a different tier), and a wrong
 * category (the garment-safe fallback). At most 5 verifications.
 */
export async function verifyWithFixes(
  draft: DraftRow,
  base: { categoryId: string; sku: string; storeFooter: string | null; descPrefs?: DescriptionPrefs | null },
  addFields: Pick<TradingItemInput, "uuid" | "policies" | "postalCode" | "scheduleTime">,
  call: (c: TradingCall, item: TradingItemInput) => Promise<TradingResult> = tradingItemCall,
): Promise<{ result: TradingResult; item: TradingItemInput; missingRequired: string[]; attempts: number; bestOfferDropped?: boolean }> {
  let categoryId = base.categoryId;
  let typed = true;
  let dropBestOffer = false;
  let condIdx = 0;
  let triedFallbackCategory = false;
  let built = await buildItemForDraft(draft, { ...base, categoryId, packageTyped: typed });
  let item: TradingItemInput = { ...built.item, ...addFields, forAdd: true };
  // Pre-flight: a value eBay is known to reject (Size "9") is never sent —
  // the seller gets the field name and valid choices instead.
  const preflight = rejectedValuesError(built.rejected);
  if (preflight) {
    const failed: TradingResult = { ack: "Failure", ok: false, itemId: null, errors: [{ short: preflight, long: preflight, code: "", severity: "Error", params: [] }], warnings: [], feesTotal: null, startTime: null };
    return { result: failed, item, missingRequired: built.missingRequired, attempts: 0 };
  }
  let result = await call("VerifyAddFixedPriceItem", item);
  let attempts = 1;
  while (!result.ok && attempts < 5) {
    if (isBestOfferError(result) && item.bestOffer?.enabled && !dropBestOffer) {
      // Some categories don't allow offers: list at the fixed price instead.
      dropBestOffer = true;
    } else if (isPackageError(result) && typed) {
      typed = false;
    } else if (isConditionError(result) && condIdx + 1 < built.conditionIds.length) {
      condIdx++;
    } else if (isCategoryError(result) && !triedFallbackCategory) {
      triedFallbackCategory = true;
      const safe = getSafeFallbackCategory(draft.title || "");
      if (safe === categoryId) break;
      categoryId = safe;
      condIdx = 0;
    } else {
      break;
    }
    built = await buildItemForDraft(draft, { ...base, categoryId, packageTyped: typed });
    item = { ...built.item, conditionId: built.conditionIds[condIdx] ?? built.item.conditionId, ...addFields, forAdd: true, ...(dropBestOffer ? { bestOffer: { enabled: false } } : {}) };
    result = await call("VerifyAddFixedPriceItem", item);
    attempts++;
  }
  return { result, item, missingRequired: built.missingRequired, attempts, ...(dropBestOffer ? { bestOfferDropped: true } : {}) };
}

export interface TradingPublishArgs {
  supabase: SupabaseClient;
  userId: string;
  draft: DraftRow;
  sku: string;
  categoryId: string;
  storeFooter: string | null;
  /** Settings → Store intro / Measurements: see photos. */
  descPrefs?: DescriptionPrefs | null;
  shippingProfileId: string;
  savedReturnProfileId: string | null | undefined;
  verifyOnly?: boolean;
  /** Days ahead for a scheduled ("Finish on eBay") listing. */
  scheduleDays?: number | null;
}

/** New listing via VerifyAddFixedPriceItem → AddFixedPriceItem. */
export async function publishDraftTrading(a: TradingPublishArgs, call: (c: TradingCall, item: TradingItemInput) => Promise<TradingResult> = tradingItemCall): Promise<NextResponse> {
  const profiles = await loadSellerProfiles(a.userId, a.savedReturnProfileId);
  const addFields: Pick<TradingItemInput, "uuid" | "policies" | "postalCode" | "scheduleTime"> = {
    uuid: listingUuid(a.draft.id, a.draft.ebay_listing_id ?? null),
    policies: { shippingProfileId: a.shippingProfileId, returnProfileId: profiles.returnProfileId, paymentProfileId: profiles.paymentProfileId },
    postalCode: listingPostalCode(),
    ...(a.scheduleDays ? { scheduleTime: scheduleTimeFromNow(a.scheduleDays) } : {}),
  };
  const v = await verifyWithFixes(a.draft, { categoryId: a.categoryId, sku: a.sku, storeFooter: a.storeFooter, descPrefs: a.descPrefs }, addFields, call);
  const warnings = v.result.warnings.map((w) => w.long || w.short).filter(Boolean);
  if (v.bestOfferDropped) warnings.unshift("eBay doesn't allow Best Offer for this item, so it lists at the fixed price (no offers).");
  const missingRequiredAspects = v.missingRequired.length ? v.missingRequired : undefined;
  if (!v.result.ok) {
    return NextResponse.json({ error: describeTradingErrors(v.result), verified: false, missingRequiredAspects }, { status: 400 });
  }
  if (a.verifyOnly) {
    return NextResponse.json({ success: true, verified: true, verifyOnly: true, feesTotal: v.result.feesTotal, warnings, missingRequiredAspects, categoryId: v.item.categoryId });
  }

  let add = await call("AddFixedPriceItem", v.item);
  let itemId = add.ok ? add.itemId : duplicateUuidItemId(add);
  if (!itemId && !add.ok && add.errors.length === 0) {
    // No answer we can read (e.g. dropped response): the same UUID makes a
    // retry safe -- it either lists once or returns the existing ItemID.
    add = await call("AddFixedPriceItem", v.item);
    itemId = add.ok ? add.itemId : duplicateUuidItemId(add);
  }
  if (!itemId) return NextResponse.json({ error: describeTradingErrors(add, "eBay didn't confirm the listing"), missingRequiredAspects }, { status: 400 });

  const link = await saveListingLink(a.supabase, a.userId, a.draft.id, itemId, { shipping_mode: "calculated" });
  if (a.scheduleDays) {
    await a.supabase.from("drafts").update({ ebay_scheduled_for: addFields.scheduleTime }).eq("id", a.draft.id).eq("user_id", a.userId); // migration 034; ignored before
  }
  return NextResponse.json({
    success: true,
    listingId: itemId,
    url: `https://www.ebay.com/itm/${itemId}`,
    scheduledFor: addFields.scheduleTime ?? undefined,
    missingRequiredAspects,
    warnings: warnings.length ? warnings : undefined,
    duplicateRecovered: !add.ok || undefined,
    linkWarning: link.ok ? undefined : "It's live on eBay, but Listflow couldn't record that yet. Open Drafts and tap \"Move to Listings\" if it still shows there.",
  });
}

/**
 * Pushes a listed draft's current details to its live listing in place
 * (ReviseFixedPriceItem): same item number, watchers kept. Returns
 * inventoryModel=true for a listing made with the Inventory API (Trading
 * can't revise those; the caller falls back to the old path).
 */
export async function reviseDraftListing(
  draft: DraftRow,
  opts: { categoryId: string; sku: string; storeFooter: string | null; descPrefs?: DescriptionPrefs | null; live?: LiveItem | null },
  call: (c: TradingCall, item: TradingItemInput) => Promise<TradingResult> = tradingItemCall,
): Promise<{ ok: boolean; inventoryModel?: boolean; error?: string; warnings?: string[]; missingRequired?: string[] }> {
  const built = await buildItemForDraft(draft, opts);
  const stored = sanitizeStoredSpecifics(draft.item_specifics)?.aspects;
  const item: TradingItemInput = {
    ...built.item,
    itemId: String(draft.ebay_listing_id),
    aspects: keepCustomSpecifics(built.item.aspects ?? {}, stored, opts.live?.specifics),
    // eBay-made listings keep their own category unless the draft has one.
    categoryId: opts.live && !sanitizeStoredSpecifics(draft.item_specifics)?.categoryId ? undefined : built.item.categoryId,
  };
  let r = await call("ReviseFixedPriceItem", item);
  if (!r.ok && item.bestOffer && isBestOfferError(r)) r = await call("ReviseFixedPriceItem", { ...item, bestOffer: undefined });
  if (!r.ok && isPackageError(r)) r = await call("ReviseFixedPriceItem", { ...item, package: item.package ? { ...item.package, packageType: undefined } : null });
  // A listing with sales can't change category/condition: retry without them.
  if (!r.ok && (isCategoryError(r) || isConditionError(r))) r = await call("ReviseFixedPriceItem", { ...item, categoryId: undefined, conditionId: undefined, conditionDescription: undefined });
  if (r.ok) return { ok: true, warnings: r.warnings.map((w) => w.long || w.short), missingRequired: built.missingRequired };
  return { ok: false, inventoryModel: isInventoryModelError(r), error: describeTradingErrors(r, "eBay rejected the update") };
}
