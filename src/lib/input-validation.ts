// Small server-side input checks shared by the API routes (Security 4e).
// Browser-safe and dependency-free. The aim is to reject wrong TYPES and
// absurd SIZES early with a clear 400, not to second-guess content.
import { isPrivatePhotoRef } from "@/lib/private-photos";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EBAY_ITEM_ID_RE = /^\d{9,15}$/;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** A list of UUIDs (1..max); null when anything is off. */
export function uuidList(v: unknown, max = 500): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) return null;
  return v.every(isUuid) ? (v as string[]) : null;
}

/** string | number | boolean | null within maxLen chars (AI fields come in a few shapes). */
export function isScalarText(v: unknown, maxLen: number): boolean {
  if (v === null) return true;
  if (typeof v === "string") return v.length <= maxLen;
  if (typeof v === "number") return Number.isFinite(v);
  return typeof v === "boolean";
}

export function isMoney(v: unknown, max = 100_000): boolean {
  return v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max);
}

/** A photo we can store on a draft: a web URL or a private draft-photo link (never data:/javascript:). */
export function isPhotoUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 2048) return false;
  if (isPrivatePhotoRef(v)) return true;
  try {
    // http allowed too: older eBay-hosted picture links can be plain http.
    const p = new URL(v).protocol;
    return p === "https:" || p === "http:";
  } catch {
    return false;
  }
}

const TEXT_LIMITS: Record<string, number> = {
  title: 500, brand: 200, color: 200, size: 100, condition: 100, flaws: 2000, itemType: 200,
  style: 200, material: 300, theme: 200, sleeveLength: 100, neckline: 100, fit: 100, pattern: 200,
  description: 500_000, vintage: 50, character: 200, characterFamily: 200, yearManufactured: 50,
  season: 100, storeCategoryName: 300, sellOdds: 50, customSku: 100,
};
const MONEY_FIELDS = ["suggestedPrice", "avgSold", "activeRangeLow", "activeRangeHigh"];

/** Type/size problems in a draft create/update body, or null when fine. */
export function draftFieldsError(body: Record<string, unknown>): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Body must be a JSON object.";
  for (const [k, max] of Object.entries(TEXT_LIMITS)) {
    if (body[k] !== undefined && !isScalarText(body[k], max)) return `${k} must be text of at most ${max} characters.`;
  }
  for (const k of MONEY_FIELDS) {
    if (body[k] !== undefined && !isMoney(body[k])) return `${k} must be a number between 0 and 100000, or null.`;
  }
  if (body.ebayListingId !== undefined && body.ebayListingId !== null && !(typeof body.ebayListingId === "string" && EBAY_ITEM_ID_RE.test(body.ebayListingId))) {
    return "ebayListingId must be an eBay item number, or null.";
  }
  if (body.photoUrls !== undefined && body.photoUrls !== null) {
    if (!Array.isArray(body.photoUrls) || body.photoUrls.length > 24 || !body.photoUrls.every(isPhotoUrl)) {
      return "photoUrls must be up to 24 photo links.";
    }
  }
  if (body.thumbnailUrl !== undefined && body.thumbnailUrl !== null && !isPhotoUrl(body.thumbnailUrl)) {
    return "thumbnailUrl must be a photo link, or null.";
  }
  if (body.itemSpecifics !== undefined && body.itemSpecifics !== null && JSON.stringify(body.itemSpecifics).length > 50_000) {
    return "itemSpecifics is too large.";
  }
  return null;
}

const MAX_IMAGE_B64 = 12_000_000; // ~9 MB of image per photo, base64

/** Problems with a list of analysis images ({data, mediaType} and/or {url}), or null. */
export function imageListError(images: unknown, max: number): string | null {
  if (!Array.isArray(images) || images.length === 0) return "At least one image is required.";
  if (images.length > max) return `At most ${max} images per request.`;
  for (const img of images) {
    if (!img || typeof img !== "object" || Array.isArray(img)) return "Each image must be an object.";
    const { data, mediaType, url } = img as { data?: unknown; mediaType?: unknown; url?: unknown };
    if (data !== undefined && (typeof data !== "string" || data.length > MAX_IMAGE_B64)) return "Image data is missing or too large.";
    if (mediaType !== undefined && (typeof mediaType !== "string" || !/^image\/[a-z0-9.+-]{1,30}$/i.test(mediaType))) return "Unsupported image type.";
    if (url !== undefined && (typeof url !== "string" || url.length > 2048)) return "Invalid image link.";
    if (data === undefined && url === undefined) return "Each image needs data or a link.";
  }
  return null;
}
