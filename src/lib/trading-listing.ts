// Trading API (XML) listing builder + response parsing. Pure and
// browser-safe (no network); the calls live in src/lib/trading-publish.ts.
//
// Why Trading and not the Inventory API (Nov 24, 2026): listings created
// through the Inventory API "cannot be edited through Seller Hub or any
// other listing platform" (eBay's Inventory API overview), so they could
// never be edited in the eBay app. Trading listings are ordinary eBay
// listings: editable in the eBay app/Seller Hub AND revisable from
// Listflow with ReviseFixedPriceItem, whichever side created them.
import { createHash } from "node:crypto";

/** Schema version sent with the new Trading calls (current reference: 1489). */
export const TRADING_COMPAT_LEVEL = "1489";

/** Inventory API condition enum -> Trading ConditionID. */
export const CONDITION_ENUM_TO_ID: Record<string, number> = {
  NEW: 1000,
  NEW_OTHER: 1500,
  NEW_WITH_DEFECTS: 1750,
  LIKE_NEW: 2750,
  PRE_OWNED_EXCELLENT: 2990,
  USED_EXCELLENT: 3000,
  PRE_OWNED_FAIR: 3010,
  USED_VERY_GOOD: 4000,
  USED_GOOD: 5000,
  USED_ACCEPTABLE: 6000,
  FOR_PARTS_OR_NOT_WORKING: 7000,
};

/** Inventory API package type -> Trading ShippingPackageCodeType. */
export const PACKAGE_TYPE_TO_CODE: Record<string, string> = {
  PACKAGE_THICK_ENVELOPE: "PackageThickEnvelope",
  PARCEL_OR_PADDED_ENVELOPE: "ParcelOrPaddedEnvelope",
  MAILING_BOX: "MailingBoxes",
  LETTER: "Letter",
  LARGE_ENVELOPE: "LargeEnvelope",
};

export interface TradingPackage {
  weightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  /** Inventory-style package type (mapped), omitted for the "untyped" retry. */
  packageType?: string;
}

export interface TradingItemInput {
  /** Set for ReviseFixedPriceItem; absent for Add/Verify. */
  itemId?: string;
  title: string;
  descriptionHtml: string;
  categoryId?: string;
  conditionId?: number;
  conditionDescription?: string | null;
  aspects?: Record<string, string[]>;
  pictureUrls?: string[];
  price?: number;
  quantity?: number;
  sku?: string | null;
  /** Duplicate guard (Add only): 32 hex chars. */
  uuid?: string;
  /** Add only. */
  policies?: { shippingProfileId: string; returnProfileId?: string | null; paymentProfileId?: string | null };
  package?: TradingPackage | null;
  storeCategoryId?: string | null;
  /** Add only. */
  postalCode?: string;
  /** Add only: ISO time to go live later (scheduled listing). */
  scheduleTime?: string;
  /** Add only (revise keeps the listing's own). */
  forAdd?: boolean;
}

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function cdata(s: string): string {
  return `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

const tag = (name: string, value: string | number | null | undefined) =>
  value === null || value === undefined || value === "" ? "" : `<${name}>${typeof value === "number" ? value : xmlEscape(value)}</${name}>`;

/** The <Item>…</Item> block for Add/Verify (forAdd) or Revise (itemId). */
export function buildTradingItemXml(i: TradingItemInput): string {
  const parts: string[] = [];
  if (i.itemId) parts.push(tag("ItemID", i.itemId));
  if (i.title) parts.push(tag("Title", i.title.slice(0, 80)));
  if (i.descriptionHtml) parts.push(`<Description>${cdata(i.descriptionHtml)}</Description>`);
  if (i.categoryId) parts.push(`<PrimaryCategory><CategoryID>${xmlEscape(i.categoryId)}</CategoryID></PrimaryCategory>`);
  if (i.conditionId) parts.push(tag("ConditionID", i.conditionId));
  if (i.conditionDescription !== undefined && i.conditionDescription !== null && i.conditionId && i.conditionId >= 2000) {
    parts.push(tag("ConditionDescription", i.conditionDescription.slice(0, 1000)));
  }
  if (i.aspects) {
    const lists = Object.entries(i.aspects)
      .filter(([n, vs]) => n.trim() && vs.some((v) => v.trim()))
      .map(([n, vs]) => `<NameValueList>${tag("Name", n.slice(0, 65))}${vs.filter((v) => v.trim()).map((v) => tag("Value", v.slice(0, 65))).join("")}</NameValueList>`);
    if (lists.length) parts.push(`<ItemSpecifics>${lists.join("")}</ItemSpecifics>`);
  }
  if (i.pictureUrls?.length) {
    parts.push(`<PictureDetails>${i.pictureUrls.slice(0, 24).map((u) => tag("PictureURL", u)).join("")}</PictureDetails>`);
  }
  if (i.price !== undefined) parts.push(`<StartPrice currencyID="USD">${i.price.toFixed(2)}</StartPrice>`);
  if (i.quantity !== undefined) parts.push(tag("Quantity", Math.max(0, Math.floor(i.quantity))));
  if (i.sku) parts.push(tag("SKU", i.sku.slice(0, 50)));
  if (i.package) {
    const p = i.package;
    const lb = Math.floor(p.weightOz / 16);
    const oz = Math.max(0, Math.ceil(p.weightOz - lb * 16));
    const code = p.packageType ? PACKAGE_TYPE_TO_CODE[p.packageType] : undefined;
    parts.push(
      `<ShippingPackageDetails><MeasurementUnit>English</MeasurementUnit>` +
        `<PackageDepth>${Math.max(1, Math.round(p.heightIn))}</PackageDepth><PackageLength>${Math.max(1, Math.round(p.lengthIn))}</PackageLength><PackageWidth>${Math.max(1, Math.round(p.widthIn))}</PackageWidth>` +
        (code ? tag("ShippingPackage", code) : "") +
        `<WeightMajor>${lb}</WeightMajor><WeightMinor>${oz}</WeightMinor></ShippingPackageDetails>`,
    );
  }
  if (i.storeCategoryId) parts.push(`<Storefront>${tag("StoreCategoryID", i.storeCategoryId)}</Storefront>`);
  if (i.forAdd) {
    parts.push("<Country>US</Country><Currency>USD</Currency><ListingDuration>GTC</ListingDuration><ListingType>FixedPriceItem</ListingType>");
    if (i.postalCode) parts.push(tag("PostalCode", i.postalCode));
    if (i.uuid) parts.push(tag("UUID", i.uuid));
    if (i.scheduleTime) parts.push(tag("ScheduleTime", i.scheduleTime));
    if (i.policies) {
      parts.push(
        `<SellerProfiles>` +
          `<SellerShippingProfile>${tag("ShippingProfileID", i.policies.shippingProfileId)}</SellerShippingProfile>` +
          (i.policies.returnProfileId ? `<SellerReturnProfile>${tag("ReturnProfileID", i.policies.returnProfileId)}</SellerReturnProfile>` : "") +
          (i.policies.paymentProfileId ? `<SellerPaymentProfile>${tag("PaymentProfileID", i.policies.paymentProfileId)}</SellerPaymentProfile>` : "") +
          `</SellerProfiles>`,
      );
    }
  }
  return `<Item>${parts.join("")}</Item>`;
}

export function tradingRequestXml(call: "AddFixedPriceItem" | "VerifyAddFixedPriceItem" | "ReviseFixedPriceItem", itemXml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><${call}Request xmlns="urn:ebay:apis:eBLBaseComponents"><ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel>${itemXml}</${call}Request>`;
}

// ---------- responses ----------

export interface TradingError {
  code: string;
  severity: "Error" | "Warning";
  short: string;
  long: string;
  params: string[];
}

export interface TradingResult {
  ack: "Success" | "Warning" | "Failure" | "PartialFailure" | string;
  ok: boolean;
  itemId: string | null;
  errors: TradingError[];
  warnings: TradingError[];
  /** Sum of listing fees eBay quoted (excludes the "ListingFee" total line). */
  feesTotal: number | null;
  startTime: string | null;
}

const first = (xml: string, t: string) => xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1]?.trim() ?? "";
const all = (xml: string, t: string) => [...xml.matchAll(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "g"))].map((m) => m[1]);
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export function parseTradingResponse(xml: string): TradingResult {
  const ack = first(xml, "Ack") || "Failure";
  const errs: TradingError[] = all(xml, "Errors").map((e) => ({
    code: first(e, "ErrorCode"),
    severity: (first(e, "SeverityCode") === "Warning" ? "Warning" : "Error") as "Error" | "Warning",
    short: unescape(first(e, "ShortMessage")),
    long: unescape(first(e, "LongMessage")),
    params: all(e, "Value").map(unescape),
  }));
  let feesTotal: number | null = null;
  const fees = all(xml, "Fee");
  if (fees.length) {
    feesTotal = 0;
    for (const f of fees) {
      if (first(f, "Name") === "ListingFee") continue;
      const v = parseFloat(first(f, "Fee"));
      if (Number.isFinite(v)) feesTotal += v;
    }
    feesTotal = Math.round(feesTotal * 100) / 100;
  }
  const itemId = first(xml, "ItemID") || null;
  return {
    ack,
    ok: ack === "Success" || ack === "Warning",
    itemId,
    errors: errs.filter((e) => e.severity === "Error"),
    warnings: errs.filter((e) => e.severity === "Warning"),
    feesTotal,
    startTime: first(xml, "StartTime") || null,
  };
}

/** Error 488 ("Duplicate UUID used"): the listing from the earlier call already exists; its ItemID is the parameter. */
export function duplicateUuidItemId(r: TradingResult): string | null {
  const e = r.errors.find((x) => x.code === "488");
  return e?.params.find((p) => /^\d{9,15}$/.test(p)) ?? null;
}

/** The listing was created with the Inventory API: Trading can't revise it. */
export function isInventoryModelError(r: TradingResult): boolean {
  return r.errors.some((e) => e.code === "21919474" || /inventory-based listing management|not allowed for inventory items/i.test(`${e.short} ${e.long}`));
}

export function isPackageError(r: TradingResult): boolean {
  return r.errors.some((e) => /shippingpackage|package weight|package dimension|package type/i.test(`${e.short} ${e.long}`));
}

export function isConditionError(r: TradingResult): boolean {
  return r.errors.some((e) => /condition/i.test(`${e.short} ${e.long}`) && !/description/i.test(e.short));
}

export function isCategoryError(r: TradingResult): boolean {
  return r.errors.some((e) => /category|item specific|is missing|required/i.test(`${e.short} ${e.long}`) && !/package|shipping/i.test(`${e.short} ${e.long}`));
}

export function describeTradingErrors(r: TradingResult, fallback = "eBay rejected the listing"): string {
  if (!r.errors.length) return fallback;
  return r.errors.map((e) => `${e.long || e.short}${e.code ? ` (code ${e.code})` : ""}`).join(" · ");
}

/**
 * Duplicate-listing guard for AddFixedPriceItem: same draft + same "round"
 * = same UUID, so a retried call returns error 488 with the existing ItemID
 * instead of listing twice. A deliberate later relist of the same draft uses
 * a new round (the previous listing's ID), so it isn't blocked.
 */
export function listingUuid(draftId: string, round: string | null | undefined): string {
  return createHash("sha256").update(`${draftId}:${round ?? "first"}`).digest("hex").slice(0, 32).toUpperCase();
}

/** ISO time `days` from now, on the hour (eBay schedules up to 3 weeks out). */
export function scheduleTimeFromNow(days: number, now = Date.now()): string {
  const d = new Date(now + days * 86_400_000);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

/** 5-digit US ZIP for Item.PostalCode (env override, else the same default the Inventory path used). */
export function listingPostalCode(env: Record<string, string | undefined> = process.env): string {
  for (const v of [env.EBAY_ITEM_POSTAL_CODE, env.EBAY_ITEM_LOCATION]) {
    const zip = v?.match(/\b(\d{5})\b/)?.[1];
    if (zip) return zip;
  }
  return "33125";
}

export type PublishApi = "trading" | "inventory";
/** PUBLISH_API=inventory switches publishing back to the old Inventory API path. */
export function publishApi(env: Record<string, string | undefined> = process.env): PublishApi {
  return env.PUBLISH_API?.trim().toLowerCase() === "inventory" ? "inventory" : "trading";
}
