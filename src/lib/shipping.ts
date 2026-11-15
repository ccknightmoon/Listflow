// Weight-based shipping cost estimation. Previously this only answered a
// yes/no "is this heavy" question and fed a flat $6.50 / $14 guess into the
// pricing formula — a t-shirt and a lightweight jacket both got charged the
// same "not heavy" number, and a denim jacket and a winter parka both got
// charged the same "heavy" number. This estimates an actual weight in
// pounds from the item type/size/material the AI already detects, then maps
// that to a shipping cost using real USPS Ground Advantage weight breaks
// (commercial-ish rates, rounded up a bit for packaging + a safety margin —
// this is still an estimate, not a live rate lookup or a quote from eBay's
// own calculated-shipping program, which needs real package dimensions and
// a dedicated shipping policy on the eBay account; this stays inside the
// app's existing flat-rate-with-override shipping policies).
//
// Rates anchored against USPS Ground Advantage commercial pricing,
// mid-distance zones, checked August 2026 — postal rates change roughly
// annually, so these are worth a periodic sanity check against usps.com.

interface WeightBand {
  maxLb: number;
  cost: number;
}

// Ascending by weight. The last entry's maxLb is effectively "and up."
const WEIGHT_BANDS: WeightBand[] = [
  { maxLb: 1, cost: 8 },
  { maxLb: 2, cost: 9 },
  { maxLb: 3, cost: 10 },
  { maxLb: 5, cost: 12 },
  { maxLb: 10, cost: 16 },
  { maxLb: Infinity, cost: 22 },
];

// Rough average weight, in pounds, for one of this item at a "Medium" size —
// deliberately approximate. Order matters: more specific/heavier terms are
// checked before generic ones so e.g. "denim jacket" matches jacket-weight
// terms, not jeans. Every pattern also accepts a plural ("pants",
// "boots", "dresses") -- \bpant\b alone never matched "pants".
const ITEM_TYPE_WEIGHTS: Array<{ re: RegExp; lb: number }> = [
  { re: /\b(boots?)(?:e?s)?\b/i, lb: 3.2 },
  { re: /\b(coat|parka|puffer|overcoat|trench|winter jacket)(?:e?s)?\b/i, lb: 2.6 },
  { re: /\b(jacket|blazer|bomber|windbreaker)(?:e?s)?\b/i, lb: 1.5 },
  { re: /\b(hoodie|sweatshirt)(?:e?s)?\b/i, lb: 1.3 },
  { re: /\b(sweater|cardigan|knit)(?:e?s)?\b/i, lb: 1.0 },
  { re: /\b(jeans|denim)(?:e?s)?\b/i, lb: 1.5 },
  { re: /\b(pant|trouser|cargo|chino|jogger|sweatpant)(?:e?s)?\b/i, lb: 1.0 },
  { re: /\b(shoe|sneaker|loafer|heel|flat|sandal)(?:e?s)?\b/i, lb: 1.8 },
  { re: /\b(handbag|purse|tote|backpack|satchel|crossbody)(?:e?s)?\b/i, lb: 1.2 },
  { re: /\b(dress|gown|sundress)(?:e?s)?\b/i, lb: 0.8 },
  { re: /\b(skirt)(?:e?s)?\b/i, lb: 0.5 },
  { re: /\b(shorts)(?:e?s)?\b/i, lb: 0.6 },
  { re: /\b(polo|blouse|button-up|button-down|henley)(?:e?s)?\b/i, lb: 0.5 },
  { re: /\b(shirt|tee|t-shirt|top)(?:e?s)?\b/i, lb: 0.4 },
];
const DEFAULT_ITEM_LB = 0.8; // unknown item type — a middling clothing guess
const PACKAGING_LB = 0.3; // mailer/box + label, added to every estimate

const HEAVY_MATERIAL_RE = /\b(wool|leather|denim|corduroy)\b/i;

// Bigger sizes mean more fabric — small correction, not a precise model.
function sizeMultiplier(size?: string | null): number {
  const s = (size || "").toUpperCase().trim();
  if (/^(XXS|XS)$/.test(s)) return 0.85;
  if (/^S$/.test(s)) return 0.9;
  if (/^M$/.test(s)) return 1.0;
  if (/^L$/.test(s)) return 1.1;
  if (/^(XL|1X)$/.test(s)) return 1.2;
  if (/^(XXL|2X|3X|XXXL)$/.test(s)) return 1.35;
  if (/^(4X|5X)$/.test(s)) return 1.5;
  return 1.0;
}

export function estimateWeightLb(itemType?: string | null, size?: string | null, material?: string | null): number {
  const match = ITEM_TYPE_WEIGHTS.find((w) => itemType && w.re.test(itemType));
  let lb = match?.lb ?? DEFAULT_ITEM_LB;
  lb *= sizeMultiplier(size);
  if (material && HEAVY_MATERIAL_RE.test(material)) lb *= 1.15;
  return lb + PACKAGING_LB;
}

export function shippingCostForWeight(weightLb: number): number {
  const band = WEIGHT_BANDS.find((b) => weightLb <= b.maxLb) ?? WEIGHT_BANDS[WEIGHT_BANDS.length - 1];
  return band.cost;
}

// eBay's "Calculated" shipping needs a declared package type + box
// dimensions (in addition to weight) so it can quote a real per-buyer rate —
// see PackageWeightAndSize in the Inventory API. These are the same weight
// brackets used for cost estimation above, mapped to eBay's PackageTypeEnum
// and a reasonable box footprint for used clothing. Like the weight
// estimate itself, this is a declared estimate, not a measurement — if it's
// off, eBay quotes a slightly wrong calculated rate, the same tradeoff the
// flat "buyer pays" cost estimate already carries.
export interface PackageEstimate {
  packageType: string;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
}

const PACKAGE_BANDS: Array<{ maxLb: number } & PackageEstimate> = [
  { maxLb: 1, packageType: "PACKAGE_THICK_ENVELOPE", lengthIn: 12, widthIn: 9, heightIn: 1 },
  { maxLb: 3, packageType: "PARCEL_OR_PADDED_ENVELOPE", lengthIn: 12, widthIn: 9, heightIn: 3 },
  { maxLb: 5, packageType: "MAILING_BOX", lengthIn: 14, widthIn: 10, heightIn: 4 },
  { maxLb: 10, packageType: "MAILING_BOX", lengthIn: 16, widthIn: 12, heightIn: 6 },
  { maxLb: Infinity, packageType: "MAILING_BOX", lengthIn: 18, widthIn: 14, heightIn: 8 },
];

export function estimatePackage(weightLb: number): PackageEstimate {
  const band = PACKAGE_BANDS.find((b) => weightLb <= b.maxLb) ?? PACKAGE_BANDS[PACKAGE_BANDS.length - 1];
  const { packageType, lengthIn, widthIn, heightIn } = band;
  return { packageType, lengthIn, widthIn, heightIn };
}

export interface ShippingEstimate {
  weightLb: number;
  cost: number;
  isHeavy: boolean;
  package: PackageEstimate;
}

// Who pays for shipping on a given listing — a seller choice, not something
// that should be silently decided by weight. "free" bakes the estimated
// shipping cost into the item price (buyer sees "Free shipping"); "buyer_pays"
// charges the buyer a flat dollar amount the seller sets; "calculated" lets
// eBay quote each buyer their own real rate at checkout based on the
// package's declared weight/dimensions and the buyer's own zip code (real
// carrier rates, not a flat guess). `isHeavy` above still matters for the
// cost *estimate* itself (a coat and a t-shirt should get different dollar
// figures) — it just no longer decides which mode is used on its own.
export type ShippingMode = "free" | "buyer_pays" | "calculated";

// Narrows arbitrary request-body input to a real ShippingMode, defaulting to
// "free" for anything unrecognized — the one place this parsing happens so
// every API route treats an invalid/missing mode the same way.
export function parseShippingMode(v: unknown): ShippingMode {
  return v === "buyer_pays" || v === "calculated" ? v : "free";
}

// The one function that matters — everything else here supports it.
// Estimates a real weight from what the AI already detected, prices it
// against USPS weight breaks, and decides whether it clears the bar for
// ListFlow's "heavy" shipping policy (anything landing above the
// free-shipping tier's assumed ~$8 baseline).
export function estimateShipping(itemType?: string | null, size?: string | null, material?: string | null): ShippingEstimate {
  const weightLb = estimateWeightLb(itemType, size, material);
  const cost = shippingCostForWeight(weightLb);
  return { weightLb: Math.round(weightLb * 10) / 10, cost, isHeavy: cost > 8, package: estimatePackage(weightLb) };
}

// --- Backward-compatible wrappers (existing call sites keep working) ---

export function estimateIsHeavy(itemType?: string | null, material?: string | null): boolean {
  return estimateShipping(itemType, undefined, material).isHeavy;
}

export function estimateShippingCost(isHeavy: boolean): number {
  return isHeavy ? 14 : 6.5;
}

// --- eBay inventory-item package details -----------------------------------
//
// Why this exists: eBay rejects publishOffer with errorId 25101
// "Invalid <ShippingPackage>." (or "The package weight is not valid or is
// missing") whenever the listing's fulfillment policy prices any service by
// carrier rate -- and that includes "free shipping" policies created in
// Seller Hub as calculated policies with a free first service. The app used
// to attach package details ONLY in its own "calculated" mode, so a draft in
// "free" mode on a calculated-type policy had no package at all (this is the
// Sept 12 "BDG Pants" failure). Package details are harmless on flat-rate
// policies, so they are now always sent.
//
// Two variants, tried in order by the publish route:
//  - "typed": weight + dimensions + an eBay PackageTypeEnum value.
//  - "untyped": weight + dimensions only. eBay forum reports show 25101 is
//    also raised when the packageType isn't one the policy's shipping
//    services accept, and that omitting packageType clears it. Used as the
//    one automatic retry when the typed attempt is rejected.
export type PackageVariant = "typed" | "untyped";

export interface EbayPackageWeightAndSize {
  packageType?: string;
  weight: { value: number; unit: "OUNCE" };
  dimensions: { length: number; width: number; height: number; unit: "INCH" };
}

// Whole ounces, rounded UP (never under-declare postage), minimum 1 oz.
// Ounces instead of fractional pounds so eBay's pounds+ounces conversion
// never sees a value like 0.74 lb.
export function weightOunces(weightLb: number): number {
  if (!Number.isFinite(weightLb) || weightLb <= 0) return 1;
  return Math.max(1, Math.ceil(Math.round(weightLb * 16 * 1000) / 1000));
}

export function buildPackageWeightAndSize(
  itemType?: string | null,
  size?: string | null,
  material?: string | null,
  variant: PackageVariant = "typed",
): EbayPackageWeightAndSize {
  const weightLb = estimateWeightLb(itemType, size, material);
  const pkg = estimatePackage(weightLb);
  const dims = {
    length: Math.max(1, Math.round(pkg.lengthIn)),
    width: Math.max(1, Math.round(pkg.widthIn)),
    height: Math.max(1, Math.round(pkg.heightIn)),
    unit: "INCH" as const,
  };
  return {
    ...(variant === "typed" ? { packageType: pkg.packageType } : {}),
    weight: { value: weightOunces(weightLb), unit: "OUNCE" },
    dimensions: dims,
  };
}

// True when an eBay error is about the package declaration (type, weight
// or size), i.e. the kind of rejection the "untyped" retry can fix.
export function isShippingPackageError(err: { errorId?: number; message?: string; longMessage?: string } | undefined): boolean {
  if (!err) return false;
  if (err.errorId === 25101) return true;
  const text = `${err.message ?? ""} ${err.longMessage ?? ""}`.toLowerCase();
  return text.includes("shippingpackage") || text.includes("package weight") || text.includes("package dimension");
}
