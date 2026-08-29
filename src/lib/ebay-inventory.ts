import https from "node:https";
import { getAccessToken } from "./ebay-oauth";

export const CONDITION_MAP: Record<string, string> = {
  "New with tags": "NEW",
  "New without tags": "NEW_OTHER",
  "Excellent used": "USED_EXCELLENT",
  "Good - minor flaws": "USED_GOOD",
  "Fair - notable flaws": "USED_ACCEPTABLE",
};

export function getDepartment(title: string): string {
  const lower = (title || "").toLowerCase();
  return (lower.includes("women") || lower.includes("ladies")) ? "Women" : "Men";
}

// Kept for callers that need a sync fallback (not leaf-safe — prefer getCategoryIdForTitle)
export function getCategoryId(title: string): string {
  const lower = (title || "").toLowerCase();
  if (lower.includes("women") || lower.includes("ladies")) return "15724";
  return "1059";
}

// Jewelry sub-types are checked in this order (most to least specific) so a
// title like "gold pendant necklace" lands on necklace, not a generic match.
const JEWELRY_TYPES: Array<{ re: RegExp; kind: "necklace" | "earrings" | "ring" | "bracelet" }> = [
  { re: /\b(necklace|pendant|choker)\b/, kind: "necklace" },
  { re: /\b(earring|earrings|studs?)\b/, kind: "earrings" },
  { re: /\b(ring|rings)\b/, kind: "ring" },
  { re: /\b(bracelet|bangle|anklet)\b/, kind: "bracelet" },
];

// Same idea for non-jewelry accessories — belts, wallets, hats, sunglasses,
// scarves. Checked after jewelry/bags/dresses/shoes so e.g. "backpack"
// (already a bag) or "beanie" (arguably outerwear-adjacent) don't collide.
const ACCESSORY_TYPES: Array<{ re: RegExp; kind: "belt" | "wallet" | "hat" | "sunglasses" | "scarf" }> = [
  { re: /\b(belt)\b/, kind: "belt" },
  { re: /\b(wallet|billfold|card holder)\b/, kind: "wallet" },
  { re: /\b(hat|cap|beanie|fedora|beret)\b/, kind: "hat" },
  { re: /\b(sunglasses|shades)\b/, kind: "sunglasses" },
  { re: /\b(scarf|scarves|wrap)\b/, kind: "scarf" },
];

function detectGarmentType(title: string) {
  const lower = (title || "").toLowerCase();
  const isWomens = lower.includes("women") || lower.includes("ladies");
  const isDress = /\b(dress|gown|sundress|maxi dress|midi dress)\b/.test(lower);
  const isBag = /\b(handbag|purse|tote|clutch|crossbody|satchel|backpack)\b/.test(lower);
  const jewelryMatch = JEWELRY_TYPES.find((j) => j.re.test(lower));
  const isJewelry = !isBag && !!jewelryMatch;
  const accessoryMatch = !isJewelry ? ACCESSORY_TYPES.find((a) => a.re.test(lower)) : undefined;
  const isAccessory = !isDress && !isBag && !isJewelry && !!accessoryMatch;
  const isTop = !isDress && !isBag && !isJewelry && !isAccessory && /\b(shirt|tee|t-shirt|top|blouse|polo|button-up|button-down)\b/.test(lower);
  const isOuterwear = !isDress && !isBag && !isJewelry && !isAccessory && !isTop && /\b(jacket|coat|hoodie|sweatshirt|vest|bomber|windbreaker|blazer|fleece|puffer|anorak)\b/.test(lower);
  const isBottom = !isDress && !isBag && !isJewelry && !isAccessory && !isTop && !isOuterwear && /\b(pant|jean|shorts|trouser|cargo|chino|legging|skirt|jogger|sweatpant)\b/.test(lower);
  const isShoe = !isDress && !isBag && !isJewelry && !isAccessory && /\b(shoe|boot|sneaker|sandal|slipper|loafer|heel|flat)\b/.test(lower);
  return {
    isWomens, isDress, isBag, isTop, isOuterwear, isBottom, isShoe,
    isJewelry, jewelryKind: jewelryMatch?.kind,
    isAccessory, accessoryKind: accessoryMatch?.kind,
  };
}

// Builds the query sent to eBay's own category-suggestion API. Prefers the
// AI-derived item type (e.g. "Floral Midi Dress", "Leather Crossbody Bag")
// when available — that's a much stronger signal than guessing from the
// title alone, and is what actually lets eBay's suggestion engine resolve
// categories (dresses, bags, jewelry, etc.) the old fixed keyword-bucket
// approach never covered. Falls back to the title-only heuristic when no
// AI item type was determined.
function categorySuggestionQuery(title: string, itemType?: string | null): string {
  const g = detectGarmentType(title);
  const gender = g.isWomens ? "women's" : "men's";
  if (itemType && itemType.trim()) {
    return `${gender} used ${itemType.trim()}`;
  }
  if (g.isJewelry)     return `used ${g.jewelryKind} fashion jewelry`; // jewelry categories aren't gender-split on eBay
  if (g.isAccessory)   return `${gender} used ${g.accessoryKind} accessory`;
  if (g.isBag)        return `${gender} used handbag bag`;
  if (g.isDress)      return `${gender} used dress`;
  if (g.isShoe)        return `${gender} used shoe footwear`;
  if (g.isBottom)      return `${gender} used pants jeans bottoms clothing`;
  if (g.isOuterwear)   return `${gender} used jacket coat outerwear clothing`;
  return `${gender} used shirt top clothing`;
}

// Jewelry IDs are eBay's general "Fashion Jewelry" leaves — not gender-split.
// Accessory IDs are gender-split like clothing. All cross-referenced against
// multiple independent eBay category browse-page URLs (same method used for
// the dress/bag IDs below), not just the suggestion API.
const JEWELRY_CATEGORY_IDS: Record<string, string> = {
  necklace: "155101",  // Necklaces & Pendants
  earrings: "50647",   // Earrings
  ring: "67681",       // Rings
  bracelet: "261987",  // Bracelets
};
const ACCESSORY_CATEGORY_IDS: Record<string, { womens: string; mens: string }> = {
  belt:       { womens: "3003",  mens: "2993" },
  wallet:     { womens: "45258", mens: "2996" },
  hat:        { womens: "45230", mens: "52365" },
  sunglasses: { womens: "45246", mens: "79720" },
  scarf:      { womens: "45238", mens: "45238" }, // eBay doesn't split scarves by gender
};

// Hardcoded known-good eBay leaf categories that accept all standard used conditions.
// Used as a guaranteed fallback when the taxonomy API returns an unusable category
// (e.g. Fan Apparel/Collectibles, which rejects USED_GOOD for themed shirts), or
// returns nothing at all. Dress/bag IDs (63861 / 169291) were confirmed against
// eBay's live category browse pages, not just the suggestion API — worth spot
// checking against one real listing since this session had no live eBay
// credentials to test the full path end-to-end.
export function getSafeFallbackCategory(title: string): string {
  const g = detectGarmentType(title);

  if (g.isJewelry && g.jewelryKind) return JEWELRY_CATEGORY_IDS[g.jewelryKind];
  if (g.isAccessory && g.accessoryKind) {
    const ids = ACCESSORY_CATEGORY_IDS[g.accessoryKind];
    return g.isWomens ? ids.womens : ids.mens;
  }
  if (g.isBag) return "169291";      // Women's Bags & Handbags — not split by gender on eBay
  if (g.isWomens) {
    if (g.isDress)      return "63861";  // Women's Dresses
    if (g.isShoe)        return "45333"; // Women's Shoes
    if (g.isBottom)      return "11554"; // Women's Pants
    if (g.isOuterwear)   return "45672"; // Women's Jackets & Coats
    return "53159";                      // Women's Tops & Blouses
  }
  if (g.isShoe)      return "93427";   // Men's Shoes
  if (g.isBottom)    return "57989";   // Men's Pants
  if (g.isOuterwear) return "57988";   // Men's Coats & Jackets
  return "57990";                      // Men's Casual Shirts (15687 is Fan Graphic Tees — may restrict used conditions)
}

export async function getCategoryIdForTitle(title: string, itemType?: string | null): Promise<string> {
  // Ask eBay's own taxonomy suggestion API using the best query we can build.
  // Falls back to hardcoded safe IDs — never falls back to parent-only categories.
  const query = categorySuggestionQuery(title, itemType);
  try {
    const result = await inventoryRequest(
      "GET",
      `/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(query)}`
    );
    if (result.status < 400) {
      type Suggestion = { category: { categoryId: string } };
      const suggestions = (result.data as { categorySuggestions?: Suggestion[] }).categorySuggestions;
      const id = suggestions?.[0]?.category?.categoryId;
      if (id) return id;
    }
  } catch {
    // fall through
  }
  return getSafeFallbackCategory(title);
}

export async function inventoryRequest(
  method: string,
  path: string,
  body?: object
): Promise<{ status: number; data: Record<string, unknown> }> {
  const token = await getAccessToken();
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : "";
    const buf = Buffer.from(bodyStr, "utf-8");
    const headers: Record<string, string | number> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      Accept: "application/json",
    };
    if (body) headers["Content-Length"] = buf.length;

    const req = https.request(
      { hostname: "api.ebay.com", path, method, headers },
      (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString(); });
        res.on("end", () => {
          // A throw here happens inside a Node event callback, not inside
          // this Promise's executor — it would NOT reject the promise, it'd
          // become an unhandled exception. So we must catch and reject
          // explicitly instead of letting JSON.parse throw bare.
          try {
            const data = raw ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode ?? 200, data });
          } catch {
            reject(new Error(
              `eBay returned a non-JSON response (HTTP ${res.statusCode ?? "?"}): ${raw.slice(0, 300)}`
            ));
          }
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(buf);
    req.end();
  });
}

function isAspect(v: string | null | undefined): v is string {
  return typeof v === "string" && v !== "null" && v.trim() !== "";
}

interface AspectInfo {
  mode: "FREE_TEXT" | "SELECTION_ONLY";
  cardinality: "SINGLE" | "MULTI";
  allowedValues: string[];
  required: boolean;
}

const aspectCache = new Map<string, { map: Map<string, AspectInfo>; expiresAt: number }>();
const ASPECT_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

async function fetchCategoryAspects(categoryId: string): Promise<Map<string, AspectInfo>> {
  const cached = aspectCache.get(categoryId);
  if (cached && Date.now() < cached.expiresAt) return cached.map;

  try {
    const result = await inventoryRequest(
      "GET",
      `/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=${categoryId}`
    );
    if (result.status >= 400) return new Map();

    type RawAspect = {
      localizedAspectName: string;
      aspectConstraint: {
        aspectMode: string;
        itemToAspectCardinality: string;
        // eBay's documented contract is aspectRequired: boolean, but this
        // session had no live eBay credentials to confirm the exact response
        // shape against a real category — checking aspectUsage as a fallback
        // too, so a naming mismatch degrades to "nothing flagged as missing"
        // rather than crashing. Worth confirming against one real category
        // response (e.g. log `aspectConstraint` for a known category) the
        // first time this runs against the live account.
        aspectRequired?: boolean;
        aspectUsage?: string;
      };
      aspectValues?: Array<{ localizedValue: string }>;
    };
    const rawAspects = (result.data as { aspects?: RawAspect[] }).aspects ?? [];
    const map = new Map<string, AspectInfo>();
    for (const a of rawAspects) {
      const required = a.aspectConstraint.aspectRequired === true
        || a.aspectConstraint.aspectUsage === "REQUIRED";
      map.set(a.localizedAspectName.toLowerCase(), {
        mode: a.aspectConstraint.aspectMode as "FREE_TEXT" | "SELECTION_ONLY",
        cardinality: a.aspectConstraint.itemToAspectCardinality as "SINGLE" | "MULTI",
        allowedValues: (a.aspectValues ?? []).map(v => v.localizedValue),
        required,
      });
    }
    aspectCache.set(categoryId, { map, expiresAt: Date.now() + ASPECT_CACHE_TTL_MS });
    return map;
  } catch {
    return new Map();
  }
}

function normalizeAspectValues(values: string[], info: AspectInfo): string[] {
  if (info.mode === "FREE_TEXT" || info.allowedValues.length === 0) return values;

  const result: string[] = [];
  for (const v of values) {
    const lower = v.toLowerCase();
    // Exact match
    const exact = info.allowedValues.find(a => a.toLowerCase() === lower);
    if (exact) { result.push(exact); continue; }
    // Contains match
    const partial = info.allowedValues.find(a =>
      a.toLowerCase().includes(lower) || lower.includes(a.toLowerCase())
    );
    if (partial) result.push(partial);
    // No match → omit (eBay silently drops unrecognized SELECTION_ONLY values)
  }
  // Respect cardinality
  return info.cardinality === "SINGLE" ? result.slice(0, 1) : result;
}

// Infers eBay's "Size Type" aspect (Regular / Petite / Plus / Big & Tall /
// Tall / Juniors) from what's actually on the size tag and in the title,
// instead of hardcoding "Regular" on every single listing regardless of fit.
// The AI already reads whatever's printed on the tag into `size` (e.g. "16W",
// "8P", "XLT") — this interprets the notation eBay itself uses for
// plus/petite/tall sizing, plus a couple of title keywords for phrasing the
// tag notation alone wouldn't catch (e.g. "Juniors", "Plus Size" spelled out).
// Deliberately does NOT treat plain "XXL"/"XXXL" as Plus — that notation is
// just as common on ordinary unisex/men's sizing as it is on women's plus
// lines, so guessing Plus from size letters alone would be wrong more often
// than it'd be right.
function detectSizeType(size: string | null, title: string | null): string {
  const s = (size || "").trim().toUpperCase();
  const t = (title || "").toLowerCase();

  if (/\bplus[\s-]?size\b/.test(t) || /^[1-5]X$/.test(s) || /\d+W$/.test(s)) return "Plus";
  if (/\bpetite\b/.test(t) || /\dP$/.test(s) || /^[SMLX]+P$/.test(s)) return "Petite";
  if (/\bbig\s*&?\s*tall\b/.test(t) || /^\d*XLT$/.test(s)) return "Big & Tall";
  if (/\bjuniors?\b/.test(t)) return "Juniors";
  if (/\btall\b/.test(t)) return "Tall";
  return "Regular";
}

export async function upsertInventoryItem(sku: string, draft: {
  title: string | null;
  brand: string | null;
  color: string | null;
  size: string | null;
  condition: string | null;
  flaws: string | null;
  thumbnail_url: string | null;
  photo_urls?: string[] | null;
  item_type?: string | null;
  style?: string | null;
  material?: string | null;
  theme?: string | null;
  sleeve_length?: string | null;
  neckline?: string | null;
  fit?: string | null;
  pattern?: string | null;
  description?: string | null;
  vintage?: string | null;
  character?: string | null;
  character_family?: string | null;
  year_manufactured?: string | null;
  season?: string | null;
}, categoryId = "1059", conditionOverride?: string) {
  const aspects: Record<string, string[]> = {};
  aspects["Department"] = [getDepartment(draft.title || "")];
  // Derived from the actual size tag/title (see detectSizeType) rather than
  // hardcoded — Country of Origin, by contrast, was previously hardcoded to
  // "United States" for every single listing regardless of whether that was
  // true. That's a factual claim eBay and buyers can act on (customs,
  // sourcing questions), so it's no longer set here at all — if a category
  // actually requires it, it now shows up in missingRequiredAspects below
  // instead of being fabricated.
  aspects["Size Type"] = [detectSizeType(draft.size, draft.title)];
  if (isAspect(draft.brand)) aspects["Brand"] = [draft.brand];
  if (isAspect(draft.color)) aspects["Color"] = [draft.color];

  // For pants, split "WaistxInseam" (e.g. "38x32") into separate aspects
  const titleLower = (draft.title || "").toLowerCase();
  const isOuterwearItem = /\b(jacket|coat|hoodie|sweatshirt|vest|bomber|windbreaker|blazer|fleece|puffer|anorak)\b/.test(titleLower);
  const isBottomItem = !isOuterwearItem && /\b(pant|jean|shorts|trouser|cargo|chino|legging|skirt|jogger|sweatpant)\b/.test(titleLower);
  if (isAspect(draft.size)) {
    const pantsMatch = isBottomItem && draft.size.match(/^(\d+)[xX](\d+)$/);
    if (pantsMatch) {
      aspects["Waist Size"] = [`${pantsMatch[1]} in`];
      aspects["Inseam"] = [`${pantsMatch[2]} in`];
      aspects["Size"] = [draft.size];
    } else {
      aspects["Size"] = [draft.size];
    }
  }
  // Shoe categories expect "US Shoe Size" as the aspect name, not the
  // generic "Size" used for clothing — set both so whichever the category
  // actually wants gets picked up by the normalization pass below instead
  // of silently missing (the AI already reads the shoe size off the
  // box/tag into `size`, same as it does for clothing).
  const isShoeItem = /\b(shoe|boot|sneaker|sandal|slipper|loafer|heel|flat)\b/.test(titleLower);
  if (isShoeItem && isAspect(draft.size)) {
    aspects["US Shoe Size"] = [draft.size];
  }
  if (isAspect(draft.item_type)) aspects["Type"] = [draft.item_type];
  if (isAspect(draft.style)) aspects["Style"] = [draft.style];
  if (isAspect(draft.material)) aspects["Material"] = [draft.material];
  // Theme can be multi-value on eBay (e.g. "90s", "Vintage", "Music")
  if (isAspect(draft.theme)) aspects["Theme"] = draft.theme.split(",").map(t => t.trim()).filter(Boolean);
  if (isAspect(draft.sleeve_length)) aspects["Sleeve Length"] = [draft.sleeve_length];
  if (isAspect(draft.neckline)) aspects["Neckline"] = [draft.neckline];
  if (isAspect(draft.fit)) aspects["Fit"] = [draft.fit];
  if (isAspect(draft.pattern)) aspects["Pattern"] = [draft.pattern];
  // New fields
  if (isAspect(draft.vintage)) aspects["Vintage"] = [draft.vintage === "Yes" ? "Yes" : "No"];
  if (isAspect(draft.character)) aspects["Character"] = [draft.character];
  if (isAspect(draft.character_family)) aspects["Character Family"] = [draft.character_family];
  if (isAspect(draft.year_manufactured)) aspects["Year Manufactured"] = [draft.year_manufactured];
  if (isAspect(draft.season)) aspects["Season"] = [draft.season];

  // Normalize aspect values against eBay's actual allowed values for this category.
  // SELECTION_ONLY aspects reject unrecognized values silently — normalization fixes mismatches.
  const categoryAspects = await fetchCategoryAspects(categoryId);
  for (const [aspectName, values] of Object.entries(aspects)) {
    const info = categoryAspects.get(aspectName.toLowerCase());
    if (!info) continue;
    const normalized = normalizeAspectValues(values, info);
    if (normalized.length > 0) {
      aspects[aspectName] = normalized;
    } else if (info.mode === "SELECTION_ONLY") {
      delete aspects[aspectName]; // Avoid sending invalid values eBay would drop anyway
    }
  }

  // Anything eBay actually requires for this category that we have no value
  // for at all — surfaced to the caller instead of silently fabricated or
  // silently omitted, so the review screen can flag it before the seller
  // clicks List. This is what makes the app respect whatever fields THIS
  // category needs, not just the fixed set of fields it was originally
  // built to know about.
  const missingRequiredAspects: string[] = [];
  for (const [nameLower, info] of categoryAspects.entries()) {
    if (!info.required) continue;
    const hasValue = Object.keys(aspects).some(
      (k) => k.toLowerCase() === nameLower && aspects[k]?.length > 0
    );
    if (!hasValue) {
      // Recover the original-cased name for display — eBay's response keys
      // are already human-readable, we just lowercased them for lookup.
      missingRequiredAspects.push(nameLower.replace(/\b\w/g, (c) => c.toUpperCase()));
    }
  }

  const descParts = [
    draft.brand ? `Brand: ${draft.brand}` : null,
    draft.color ? `Color: ${draft.color}` : null,
    draft.size ? `Size: ${draft.size}` : null,
    draft.condition ? `Condition: ${draft.condition}` : null,
    draft.flaws ? `Notes: ${draft.flaws}` : null,
  ].filter(Boolean);

  const condition = conditionOverride ?? CONDITION_MAP[draft.condition ?? ""] ?? "USED_GOOD";
  const isUsed = !["NEW", "NEW_OTHER"].includes(condition);

  const body: Record<string, unknown> = {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition,
    product: {
      title: (draft.title || "Item").slice(0, 80),
      description: draft.description || descParts.join("\n") || "No description.",
      aspects,
      ...(() => {
        const urls = (draft.photo_urls ?? []).filter((u) => u?.startsWith("http"));
        if (urls.length === 0 && draft.thumbnail_url?.startsWith("http")) urls.push(draft.thumbnail_url);
        return urls.length > 0 ? { imageUrls: urls.slice(0, 24) } : {};
      })(),
    },
  };

  if (isUsed && draft.flaws) {
    body.conditionDescription = draft.flaws.slice(0, 1000);
  }

  const result = await inventoryRequest("PUT", `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, body);
  return { ...result, missingRequiredAspects };
}

const MERCHANT_LOCATION_KEY = "listflow_us";

export async function ensureMerchantLocation() {
  const result = await inventoryRequest("POST", `/sell/inventory/v1/location/${MERCHANT_LOCATION_KEY}`, {
    location: { address: { country: "US", postalCode: "10001" } },
    locationTypes: ["WAREHOUSE"],
    merchantLocationStatus: "ENABLED",
    name: "Listflow Default",
  });
  if (result.status >= 400) {
    const errData = result.data as { errors?: Array<{ message?: string }> };
    const msg = (errData.errors?.[0]?.message ?? "").toLowerCase();
    // 409 / "already exists" is fine — location already set up
    if (!msg.includes("already") && !msg.includes("exist")) {
      throw new Error(`Merchant location setup failed (${result.status}): ${errData.errors?.[0]?.message ?? JSON.stringify(result.data)}`);
    }
  }
}

export async function recreateMerchantLocation() {
  // Disable then delete (both may fail if location doesn't exist — ignore)
  await inventoryRequest("POST", `/sell/inventory/v1/location/${MERCHANT_LOCATION_KEY}/disable`, undefined);
  await inventoryRequest("DELETE", `/sell/inventory/v1/location/${MERCHANT_LOCATION_KEY}`, undefined);
  // Create fresh
  await ensureMerchantLocation();
}

function buildListingPolicies(isHeavy: boolean, shippingCost?: number) {
  const fulfillmentPolicyId = isHeavy
    ? process.env.EBAY_SHIPPING_HEAVY_ID
    : process.env.EBAY_SHIPPING_FREE_ID;
  const base: Record<string, unknown> = { fulfillmentPolicyId, returnPolicyId: process.env.EBAY_RETURN_POLICY_ID };
  if (isHeavy && shippingCost && shippingCost > 0) {
    base.shippingCostOverrides = [
      { priority: 1, shippingServiceType: "DOMESTIC", shippingCost: { value: shippingCost.toFixed(2), currency: "USD" } },
    ];
  }
  return base;
}

export async function updateOffer(offerId: string, price: number, categoryId: string, isHeavy: boolean, shippingCost?: number) {
  return inventoryRequest("PUT", `/sell/inventory/v1/offer/${offerId}`, {
    availableQuantity: 1,
    categoryId,
    merchantLocationKey: MERCHANT_LOCATION_KEY,
    listingPolicies: buildListingPolicies(isHeavy, shippingCost),
    pricingSummary: {
      price: { value: price.toFixed(2), currency: "USD" },
    },
    listingDuration: "GTC",
  });
}

export async function createOffer(sku: string, price: number, categoryId: string, isHeavy = false, shippingCost?: number) {
  return inventoryRequest("POST", "/sell/inventory/v1/offer", {
    sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId,
    merchantLocationKey: MERCHANT_LOCATION_KEY,
    listingPolicies: buildListingPolicies(isHeavy, shippingCost),
    pricingSummary: {
      price: { value: price.toFixed(2), currency: "USD" },
    },
    listingDuration: "GTC",
  });
}

export async function publishOffer(offerId: string) {
  return inventoryRequest("POST", `/sell/inventory/v1/offer/${offerId}/publish`, {});
}

export async function deleteOffer(offerId: string) {
  return inventoryRequest("DELETE", `/sell/inventory/v1/offer/${offerId}`, undefined);
}

export async function deleteInventoryItem(sku: string) {
  return inventoryRequest("DELETE", `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, undefined);
}

export async function getOfferBySku(sku: string) {
  return inventoryRequest("GET", `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`);
}

export async function getAllOffers() {
  return inventoryRequest("GET", "/sell/inventory/v1/offer?limit=200&offset=0");
}

export async function getAllInventoryItems() {
  return inventoryRequest("GET", "/sell/inventory/v1/inventory_item?limit=200&offset=0");
}

// Makes a Trading API XML call. Returns status code and raw XML response body.
export async function tradingRequest(callName: string, xmlBody: string): Promise<{ status: number; body: string }> {
  const token = await getAccessToken();
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(xmlBody, "utf-8");
    const req = https.request(
      {
        hostname: "api.ebay.com",
        path: "/ws/api.dll",
        method: "POST",
        headers: {
          "X-EBAY-API-SITEID": "0",
          "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
          "X-EBAY-API-CALL-NAME": callName,
          "X-EBAY-API-IAF-TOKEN": token,
          "Content-Type": "text/xml",
          "Content-Length": buf.length,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString(); });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: raw }));
      }
    );
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

// eBay item IDs are numeric (typically 9-15 digits). Reject anything else
// before it gets interpolated into Trading API XML — both to stop XML
// injection and because a non-numeric "listing ID" can't be a real one.
const EBAY_ITEM_ID_RE = /^\d{6,15}$/;

export function isValidEbayItemId(listingId: string): boolean {
  return EBAY_ITEM_ID_RE.test(listingId);
}

// Uses Trading API EndItem to end a live listing directly by its eBay item ID.
// More reliable than SKU-based offer deletion because we always have the listing ID.
export async function endItemByListingId(listingId: string): Promise<{ success: boolean; error?: string }> {
  if (!isValidEbayItemId(listingId)) {
    return { success: false, error: `Invalid eBay item ID: "${listingId}"` };
  }
  try {
    const { body } = await tradingRequest(
      "EndItem",
      `<?xml version="1.0" encoding="utf-8"?><EndItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><EndingReason>NotAvailable</EndingReason><ItemID>${listingId}</ItemID></EndItemRequest>`
    );
    if (body.includes("<Ack>Success</Ack>") || body.includes("<Ack>Warning</Ack>")) {
      return { success: true };
    }
    const match = body.match(/<LongMessage>(.*?)<\/LongMessage>/);
    const shortMatch = body.match(/<ShortMessage>(.*?)<\/ShortMessage>/);
    return { success: false, error: match?.[1] ?? shortMatch?.[1] ?? body.slice(0, 300) };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
