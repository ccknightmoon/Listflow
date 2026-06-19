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

function garmentTypeQuery(title: string): string {
  const lower = (title || "").toLowerCase();
  const isWomens = lower.includes("women") || lower.includes("ladies");
  const gender = isWomens ? "women's" : "men's";

  const isTop = /\b(shirt|tee|t-shirt|top|blouse|polo|button-up|button-down)\b/.test(lower);
  const isBottom = !isTop && /\b(pant|jean|denim|shorts|trouser|cargo|chino|legging|skirt|jogger|sweatpant)\b/.test(lower);
  const isOuterwear = !isTop && /\b(jacket|coat|hoodie|sweatshirt|vest|bomber|windbreaker|blazer|fleece|puffer|anorak)\b/.test(lower);
  const isShoe = /\b(shoe|boot|sneaker|sandal|slipper|loafer|heel|flat)\b/.test(lower);

  if (isShoe)      return `${gender} used shoe footwear`;
  if (isBottom)    return `${gender} used pants jeans bottoms clothing`;
  if (isOuterwear) return `${gender} used jacket coat outerwear clothing`;
  return `${gender} used shirt top clothing`;
}

// Hardcoded known-good eBay leaf categories that accept all standard used conditions.
// Used as a guaranteed fallback when the taxonomy API returns an unusable category
// (e.g. Fan Apparel/Collectibles, which rejects USED_GOOD for themed shirts).
export function getSafeFallbackCategory(title: string): string {
  const lower = (title || "").toLowerCase();
  const isWomens = lower.includes("women") || lower.includes("ladies");
  const isTop = /\b(shirt|tee|t-shirt|top|blouse|polo|button-up|button-down)\b/.test(lower);
  const isBottom = !isTop && /\b(pant|jean|denim|shorts|trouser|cargo|chino|legging|skirt|jogger|sweatpant)\b/.test(lower);
  const isOuterwear = !isTop && /\b(jacket|coat|hoodie|sweatshirt|vest|bomber|windbreaker|blazer|fleece|puffer|anorak)\b/.test(lower);
  const isShoe = /\b(shoe|boot|sneaker|sandal|slipper|loafer|heel|flat)\b/.test(lower);

  if (isWomens) {
    if (isShoe)      return "45333"; // Women's Shoes
    if (isBottom)    return "11554"; // Women's Pants
    if (isOuterwear) return "45672"; // Women's Jackets & Coats
    return "53159";                  // Women's Tops & Blouses
  }
  if (isShoe)      return "93427";   // Men's Shoes
  if (isBottom)    return "57989";   // Men's Pants
  if (isOuterwear) return "57988";   // Men's Coats & Jackets
  return "57990";                    // Men's Casual Shirts (15687 is Fan Graphic Tees — may restrict used conditions)
}

export async function getCategoryIdForTitle(title: string): Promise<string> {
  // Use garment-type-based query to stay in the correct clothing leaf category.
  // Falls back to hardcoded safe IDs — never falls back to parent-only categories.
  const query = garmentTypeQuery(title);
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
          const data = raw ? JSON.parse(raw) : {};
          resolve({ status: res.statusCode ?? 200, data });
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
}, categoryId = "1059", conditionOverride?: string) {
  const aspects: Record<string, string[]> = {};
  aspects["Department"] = [getDepartment(draft.title || "")];
  aspects["Size Type"] = ["Regular"];
  if (isAspect(draft.brand)) aspects["Brand"] = [draft.brand];
  if (isAspect(draft.color)) aspects["Color"] = [draft.color];

  // For pants, split "WaistxInseam" (e.g. "38x32") into separate aspects
  const titleLower = (draft.title || "").toLowerCase();
  const isBottomItem = /\b(pant|jean|denim|shorts|trouser|cargo|chino|legging|skirt|jogger|sweatpant)\b/.test(titleLower);
  if (isAspect(draft.size)) {
    const pantsMatch = isBottomItem && draft.size.match(/^(\d+)[xX](\d+)$/);
    if (pantsMatch) {
      aspects["Waist Size"] = [`${pantsMatch[1]} in`];
      aspects["Inseam"] = [`${pantsMatch[2]} in`];
      aspects["Size"] = [draft.size]; // keep full size string too
    } else {
      aspects["Size"] = [draft.size];
    }
  }
  if (isAspect(draft.item_type)) aspects["Type"] = [draft.item_type];
  if (isAspect(draft.style)) aspects["Style"] = [draft.style];
  if (isAspect(draft.material)) aspects["Material"] = [draft.material];
  if (isAspect(draft.theme)) aspects["Theme"] = [draft.theme];
  if (isAspect(draft.sleeve_length)) aspects["Sleeve Length"] = [draft.sleeve_length];
  if (isAspect(draft.neckline)) aspects["Neckline"] = [draft.neckline];
  if (isAspect(draft.fit)) aspects["Fit"] = [draft.fit];
  if (isAspect(draft.pattern)) aspects["Pattern"] = [draft.pattern];

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
        // Use all photo_urls if available, fall back to thumbnail_url; eBay max is 24
        const urls = (draft.photo_urls ?? []).filter((u) => u?.startsWith("http"));
        if (urls.length === 0 && draft.thumbnail_url?.startsWith("http")) urls.push(draft.thumbnail_url);
        return urls.length > 0 ? { imageUrls: urls.slice(0, 24) } : {};
      })(),
    },
  };

  if (isUsed && draft.flaws) {
    body.conditionDescription = draft.flaws.slice(0, 1000);
  }

  return inventoryRequest("PUT", `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, body);
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

export async function updateOffer(offerId: string, price: number, categoryId: string, isHeavy: boolean) {
  return inventoryRequest("PUT", `/sell/inventory/v1/offer/${offerId}`, {
    availableQuantity: 1,
    categoryId,
    merchantLocationKey: MERCHANT_LOCATION_KEY,
    listingPolicies: {
      fulfillmentPolicyId: isHeavy
        ? process.env.EBAY_SHIPPING_HEAVY_ID
        : process.env.EBAY_SHIPPING_FREE_ID,
      returnPolicyId: process.env.EBAY_RETURN_POLICY_ID,
    },
    pricingSummary: {
      price: { value: price.toFixed(2), currency: "USD" },
    },
    listingDuration: "GTC",
  });
}

export async function createOffer(sku: string, price: number, categoryId: string, isHeavy = false) {
  return inventoryRequest("POST", "/sell/inventory/v1/offer", {
    sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId,
    merchantLocationKey: MERCHANT_LOCATION_KEY,
    listingPolicies: {
      fulfillmentPolicyId: isHeavy
        ? process.env.EBAY_SHIPPING_HEAVY_ID
        : process.env.EBAY_SHIPPING_FREE_ID,
      returnPolicyId: process.env.EBAY_RETURN_POLICY_ID,
    },
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
