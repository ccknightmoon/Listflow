import https from "node:https";
import { getAccessToken } from "./ebay-oauth";

export const CONDITION_MAP: Record<string, string> = {
  "New with tags": "NEW",
  "New without tags": "NEW_OTHER",
  "Excellent used": "USED_EXCELLENT",
  "Good - minor flaws": "USED_GOOD",
  "Fair - notable flaws": "USED_ACCEPTABLE",
};

export function getCategoryId(title: string): string {
  const lower = (title || "").toLowerCase();
  if (lower.includes("women") || lower.includes("ladies")) return "15724";
  return "1059";
}

export function getDepartment(categoryId: string): string {
  return categoryId === "15724" ? "Women" : "Men";
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

export async function upsertInventoryItem(sku: string, draft: {
  title: string | null;
  brand: string | null;
  color: string | null;
  size: string | null;
  condition: string | null;
  flaws: string | null;
  thumbnail_url: string | null;
}, categoryId = "1059") {
  const aspects: Record<string, string[]> = {};
  aspects["Department"] = [getDepartment(categoryId)];
  if (draft.brand) aspects["Brand"] = [draft.brand];
  if (draft.color) aspects["Color"] = [draft.color];
  if (draft.size) aspects["Size"] = [draft.size];

  const descParts = [
    draft.brand ? `Brand: ${draft.brand}` : null,
    draft.color ? `Color: ${draft.color}` : null,
    draft.size ? `Size: ${draft.size}` : null,
    draft.condition ? `Condition: ${draft.condition}` : null,
    draft.flaws ? `Notes: ${draft.flaws}` : null,
  ].filter(Boolean);

  const condition = CONDITION_MAP[draft.condition ?? ""] ?? "VERY_GOOD";
  const isUsed = !["NEW", "LIKE_NEW"].includes(condition);

  const body: Record<string, unknown> = {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition,
    product: {
      title: (draft.title || "Item").slice(0, 80),
      description: descParts.join("\n") || "No description.",
      aspects,
      ...(draft.thumbnail_url ? { imageUrls: [draft.thumbnail_url] } : {}),
    },
  };

  if (isUsed && draft.flaws) {
    body.conditionDescription = draft.flaws.slice(0, 1000);
  }

  return inventoryRequest("PUT", `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, body);
}

export async function createOffer(sku: string, price: number, categoryId: string, isHeavy = false) {
  return inventoryRequest("POST", "/sell/inventory/v1/offer", {
    sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId,
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

export async function getAllOffers() {
  return inventoryRequest("GET", "/sell/inventory/v1/offer?limit=200&offset=0");
}

export async function getAllInventoryItems() {
  return inventoryRequest("GET", "/sell/inventory/v1/inventory_item?limit=200&offset=0");
}
