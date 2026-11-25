// Draft row building/validation shared by POST /api/drafts and the
// background queue worker (Volume Phase 3).
import { draftFieldsError } from "@/lib/input-validation";
import { sanitizeStoredSpecifics, isMissingColumnError } from "@/lib/item-specifics";
import { isValidCostBasis } from "@/lib/profit";
import { storedFloorError } from "@/lib/offer-floor";

function isValidShippingCost(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function isValidStoreCategoryId(value: unknown): value is string | null {
  return value === null || value === undefined || (typeof value === "string" && /^\d+$/.test(value));
}
function isValidShippingMode(value: unknown): value is "free" | "calculated" | "buyer_pays" {
  return value === "free" || value === "calculated" || value === "buyer_pays";
}
export function normalizeCustomSku(value: unknown): string | null {
  if (typeof value !== "string") return value == null ? null : String(value);
  const sku = value.trim();
  return sku || null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON body from the client
type Body = Record<string, any>;

/** Error message for an invalid create body, or null when it's fine. */
export function draftBodyError(body: Body): string | null {
  const fields = draftFieldsError(body);
  if (fields) return fields;
  if (!isValidStoreCategoryId(body.storeCategoryId)) {
    return "Invalid store category ID.";
  }
  if (body.costBasis !== undefined && body.costBasis !== null && !isValidCostBasis(body.costBasis)) {
    return "costBasis must be a non-negative number, or null.";
  }
  if (body.isHeavy !== undefined && typeof body.isHeavy !== "boolean") {
    return "isHeavy must be a boolean.";
  }
  if (body.shippingCost !== undefined && body.shippingCost !== null && !isValidShippingCost(body.shippingCost)) {
    return "shippingCost must be a non-negative number, or null.";
  }
  if (body.shippingMode !== undefined && !isValidShippingMode(body.shippingMode)) {
    return "shippingMode must be 'free', 'calculated', or 'buyer_pays'.";
  }
  if (body.bestOfferFloor !== undefined && body.bestOfferFloor !== null) {
    const floorErr = storedFloorError(body.suggestedPrice, body.bestOfferFloor);
    if (floorErr) return floorErr;
  }

  return null;
}

/** The drafts row to insert for a create body. */
export function draftRowFromBody(userId: string, body: Body) {
  const specifics = body.itemSpecifics !== undefined ? sanitizeStoredSpecifics(body.itemSpecifics) : undefined;
  const row = {
        // Explicit stamp, even though the DB column also defaults to
        // auth.uid() — defense-in-depth matches the rest of this codebase.
        user_id: userId,
        title: body.title ?? null,
        brand: body.brand ?? null,
        color: body.color ?? null,
        size: body.size ?? null,
        condition: body.condition ?? null,
        flaws: body.flaws ?? null,
        custom_sku: normalizeCustomSku(body.customSku),
        suggested_price: body.suggestedPrice ?? null,
        avg_sold: body.avgSold ?? null,
        active_range_low: body.activeRangeLow ?? null,
        active_range_high: body.activeRangeHigh ?? null,
        sell_odds: body.sellOdds ?? null,
        thumbnail_url: body.thumbnailUrl ?? null,
        photo_urls: body.photoUrls ?? null,
        item_type: body.itemType ?? null,
        theme: body.theme ?? null,
        style: body.style ?? null,
        material: body.material ?? null,
        sleeve_length: body.sleeveLength ?? null,
        neckline: body.neckline ?? null,
        fit: body.fit ?? null,
        pattern: body.pattern ?? null,
        description: body.description ?? null,
        vintage: body.vintage ?? null,
        character: body.character ?? null,
        character_family: body.characterFamily ?? null,
        year_manufactured: body.yearManufactured ?? null,
        season: body.season ?? null,
        store_category_id: body.storeCategoryId ?? null,
        store_category_name: body.storeCategoryName ?? null,
        cost_basis: body.costBasis ?? null,
        is_heavy: body.isHeavy ?? false,
        shipping_cost: body.shippingCost ?? null,
        shipping_mode: "calculated", // calculated-only; older clients may still send free/buyer_pays
        ...(body.bestOfferFloor !== undefined && { best_offer_floor: body.bestOfferFloor ?? null }),
        ...(specifics !== undefined && { item_specifics: specifics }),
      };
  return row;
}

/**
 * Columns added by migrations that may not be applied yet (027, 035). When
 * a write fails because one is missing, returns the values without it so
 * the rest still saves; null when the error is something else.
 */
export const OPTIONAL_DRAFT_COLUMNS = ["item_specifics", "best_offer_floor"] as const;
export function withoutMissingColumn<T extends Record<string, unknown>>(values: T, error: { code?: string; message?: string } | null | undefined): T | null {
  for (const col of OPTIONAL_DRAFT_COLUMNS) {
    if (col in values && isMissingColumnError(error, col)) {
      const rest = { ...values };
      delete rest[col];
      return rest;
    }
  }
  return null;
}
