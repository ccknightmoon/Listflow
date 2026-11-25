// Price + Best Offer floor ("lowest offer I'll take") rules, shared by every
// screen that edits them, the drafts API and the eBay publish path.
//
// Floor semantics: when set, the listing goes up with Best Offer ON and eBay
// automatically declines any offer below the floor (Trading API
// ListingDetails.MinimumBestOfferPrice). Offers at/above the floor come to
// the seller to accept/counter (no auto-accept). An empty floor = Best Offer
// off, fixed price only.

import { MIN_PRICE } from "@/lib/price-floor";

/** Parses a money text field. "" / junk → null. */
export function parseMoneyText(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/[$,\s]/g, "");
  if (!s || s === "." || !/^\d*\.?\d*$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export interface PriceFloorCheck {
  ok: boolean;
  price: number | null;
  /** null = Best Offer off. */
  floor: number | null;
  priceError: string | null;
  floorError: string | null;
}

/**
 * Validates the price (required, > 0, at least eBay's $0.99) and the optional
 * floor (blank = off; otherwise at least $0.99 and below the price).
 */
export function checkPriceAndFloor(priceIn: string | number | null | undefined, floorIn: string | number | null | undefined): PriceFloorCheck {
  const price = parseMoneyText(priceIn);
  const floorBlank = floorIn === null || floorIn === undefined || (typeof floorIn === "string" && floorIn.trim() === "");
  const floor = floorBlank ? null : parseMoneyText(floorIn);
  let priceError: string | null = null;
  let floorError: string | null = null;

  if (price === null || price <= 0) priceError = "Enter a price above $0.";
  else if (price < MIN_PRICE) priceError = `eBay's lowest price is $${MIN_PRICE.toFixed(2)}.`;

  if (!floorBlank) {
    if (floor === null || floor <= 0) floorError = "Enter a floor above $0, or leave it blank for no offers.";
    else if (floor < MIN_PRICE) floorError = `Floor must be at least $${MIN_PRICE.toFixed(2)}.`;
    else if (price !== null && !priceError && floor >= price) floorError = "Floor must be lower than the price.";
  }

  return { ok: !priceError && !floorError, price, floor: floorBlank ? null : floor, priceError, floorError };
}

/** The AI's floor as a starting value: only if it's valid under the price. */
export function defaultFloorFor(price: number | null | undefined, suggestedFloor: number | null | undefined): number | null {
  if (typeof suggestedFloor !== "number" || !Number.isFinite(suggestedFloor)) return null;
  if (typeof price !== "number" || !Number.isFinite(price)) return null;
  if (suggestedFloor < MIN_PRICE || suggestedFloor >= price) return null;
  return Math.round(suggestedFloor * 100) / 100;
}

/** Money text for an input ("" for none). */
export function moneyText(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "";
}

/** Server-side check of a draft's floor against its price. Null = fine. */
export function storedFloorError(price: unknown, floor: unknown): string | null {
  if (floor === null || floor === undefined) return null;
  if (typeof floor !== "number" || !Number.isFinite(floor)) return "bestOfferFloor must be a number, or null.";
  return checkPriceAndFloor(typeof price === "number" ? price : null, floor).floorError;
}

/** Best Offer settings for a listing from the saved price + floor. */
export function bestOfferTerms(price: unknown, floor: unknown): { enabled: boolean; autoDecline?: number } {
  const p = typeof price === "number" ? price : Number(price);
  const f = typeof floor === "number" ? floor : floor == null || floor === "" ? null : Number(floor);
  if (f === null || !Number.isFinite(f) || !Number.isFinite(p) || f < MIN_PRICE || f >= p) return { enabled: false };
  return { enabled: true, autoDecline: Math.round(f * 100) / 100 };
}

/**
 * An item isn't "Ready to list" with a missing/invalid price or floor: adds
 * a blocking Price reason to its confidence (keeps the score as is).
 */
export function withPriceCheck<C extends { ready: boolean; status: "ready" | "needs-look"; reasons: { field: string; message: string; blocking: boolean; points: number }[] }>(conf: C, check: PriceFloorCheck): C {
  if (check.ok) return conf;
  const message = check.priceError ?? check.floorError ?? "Check the price";
  const field = check.priceError ? "Price" : "Offer floor";
  return { ...conf, ready: false, status: "needs-look", reasons: [{ field, message, blocking: true, points: 0 }, ...conf.reasons] };
}
