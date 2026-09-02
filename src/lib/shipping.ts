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
// terms, not jeans.
const ITEM_TYPE_WEIGHTS: Array<{ re: RegExp; lb: number }> = [
  { re: /\b(boots?)\b/i, lb: 3.2 },
  { re: /\b(coat|parka|puffer|overcoat|trench|winter jacket)\b/i, lb: 2.6 },
  { re: /\b(jacket|blazer|bomber|windbreaker)\b/i, lb: 1.5 },
  { re: /\b(hoodie|sweatshirt)\b/i, lb: 1.3 },
  { re: /\b(sweater|cardigan|knit)\b/i, lb: 1.0 },
  { re: /\b(jeans|denim)\b/i, lb: 1.5 },
  { re: /\b(pant|trouser|cargo|chino|jogger|sweatpant)\b/i, lb: 1.0 },
  { re: /\b(shoe|sneaker|loafer|heel|flat|sandal)\b/i, lb: 1.8 },
  { re: /\b(handbag|purse|tote|backpack|satchel|crossbody)\b/i, lb: 1.2 },
  { re: /\b(dress|gown|sundress)\b/i, lb: 0.8 },
  { re: /\b(skirt)\b/i, lb: 0.5 },
  { re: /\b(shorts)\b/i, lb: 0.6 },
  { re: /\b(polo|blouse|button-up|button-down|henley)\b/i, lb: 0.5 },
  { re: /\b(shirt|tee|t-shirt|top)\b/i, lb: 0.4 },
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
