// One live eBay listing via Trading GetItem: parse it, fingerprint its
// editable fields (to spot edits made in the eBay app), and turn it into
// Listflow draft fields (import). Parsing/hashing are pure; getLiveItem()
// needs an eBay request context.
import { createHash } from "node:crypto";
import { tradingRequest } from "@/lib/ebay-inventory";
import { decodeEntities } from "@/lib/html-entities";
import { TRADING_COMPAT_LEVEL } from "@/lib/trading-listing";

export interface LiveItem {
  itemId: string;
  title: string;
  descriptionHtml: string;
  price: number | null;
  quantity: number;
  quantitySold: number;
  sku: string | null;
  conditionId: number | null;
  conditionName: string | null;
  conditionDescription: string | null;
  categoryId: string | null;
  categoryName: string | null;
  specifics: Record<string, string[]>;
  pictures: string[];
  storeCategoryId: string | null;
  /** Active | Completed | Ended | ... */
  status: string;
  startTime: string | null;
  endTime: string | null;
  watchCount: number | null;
  /** Created with the Inventory API (Trading can't revise it). */
  inventoryModel: boolean;
}

const first = (xml: string, t: string) => xml.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`))?.[1]?.trim() ?? "";
const all = (xml: string, t: string) => [...xml.matchAll(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, "g"))].map((m) => m[1].trim());
const text = (s: string) => decodeEntities(s.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1"));

export function parseGetItem(xml: string): LiveItem | null {
  const item = first(xml, "Item");
  if (!item) return null;
  const itemId = first(item, "ItemID");
  if (!itemId) return null;
  const specifics: Record<string, string[]> = {};
  for (const nv of all(first(item, "ItemSpecifics"), "NameValueList")) {
    const name = text(first(nv, "Name"));
    const values = all(nv, "Value").map(text).filter(Boolean);
    if (name && values.length) specifics[name] = values;
  }
  const num = (s: string) => (s ? Number(s) : NaN);
  const price = num(first(first(item, "SellingStatus"), "CurrentPrice") || first(item, "StartPrice"));
  const qty = num(first(item, "Quantity"));
  const sold = num(first(first(item, "SellingStatus"), "QuantitySold"));
  const cond = num(first(item, "ConditionID"));
  const watch = num(first(item, "WatchCount"));
  return {
    itemId,
    title: text(first(item, "Title")),
    descriptionHtml: text(first(item, "Description")),
    price: Number.isFinite(price) ? price : null,
    quantity: Number.isFinite(qty) ? qty : 1,
    quantitySold: Number.isFinite(sold) ? sold : 0,
    sku: text(first(item, "SKU")) || null,
    conditionId: Number.isFinite(cond) ? cond : null,
    conditionName: text(first(item, "ConditionDisplayName")) || null,
    conditionDescription: text(first(item, "ConditionDescription")) || null,
    categoryId: first(first(item, "PrimaryCategory"), "CategoryID") || null,
    categoryName: text(first(first(item, "PrimaryCategory"), "CategoryName")) || null,
    specifics,
    pictures: all(first(item, "PictureDetails"), "PictureURL").map(text),
    storeCategoryId: first(first(item, "Storefront"), "StoreCategoryID") || null,
    status: first(first(item, "SellingStatus"), "ListingStatus") || "",
    startTime: first(first(item, "ListingDetails"), "StartTime") || null,
    endTime: first(first(item, "ListingDetails"), "EndTime") || null,
    watchCount: Number.isFinite(watch) ? watch : null,
    // eBay marks listings it manages through the Inventory model.
    inventoryModel: /<SellerInventoryID>|<IsInventoryModel>true/.test(item),
  };
}

/** Fingerprint of everything Listflow can edit: changes when anyone edits the listing. */
export function liveItemHash(i: LiveItem): string {
  const specifics = Object.keys(i.specifics).sort().map((k) => [k, i.specifics[k]]);
  const payload = JSON.stringify([i.title, i.price, i.quantity, i.conditionId, i.conditionDescription, i.descriptionHtml, i.pictures, specifics, i.categoryId, i.storeCategoryId]);
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

export async function getLiveItem(itemId: string): Promise<LiveItem | { error: string }> {
  if (!/^\d{9,15}$/.test(itemId)) return { error: "Invalid eBay item number." };
  const { body } = await tradingRequest(
    "GetItem",
    `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${itemId}</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>true</IncludeItemSpecifics><IncludeWatchCount>true</IncludeWatchCount></GetItemRequest>`,
    TRADING_COMPAT_LEVEL,
  );
  const parsed = parseGetItem(body);
  if (parsed) return parsed;
  const msg = body.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/)?.[1] ?? body.match(/<ShortMessage>([\s\S]*?)<\/ShortMessage>/)?.[1];
  return { error: msg ? decodeEntities(msg) : "eBay didn't return this listing." };
}

/** eBay's condition name -> Listflow's condition label. */
export function conditionLabelFor(i: Pick<LiveItem, "conditionId" | "conditionName">): string {
  const n = (i.conditionName ?? "").toLowerCase();
  if (i.conditionId === 1000 || /new with tags/.test(n)) return "New with tags";
  if ((i.conditionId ?? 0) > 0 && (i.conditionId ?? 0) < 2000) return "New without tags";
  if (/excellent|like new|very good/.test(n)) return "Excellent used";
  if (/fair|acceptable|parts/.test(n)) return "Fair - notable flaws";
  return "Good - minor flaws";
}

const pick = (s: Record<string, string[]>, ...names: string[]) => {
  for (const n of names) {
    const k = Object.keys(s).find((x) => x.toLowerCase() === n.toLowerCase());
    if (k && s[k][0]) return s[k][0];
  }
  return null;
};

/** Draft row fields for a listing opened in Listflow (import). */
export function draftFieldsFromLiveItem(i: LiveItem) {
  return {
    title: i.title.slice(0, 500),
    brand: pick(i.specifics, "Brand"),
    color: pick(i.specifics, "Color", "Colour"),
    size: pick(i.specifics, "Size", "Size (Men's)", "Size (Women's)"),
    condition: conditionLabelFor(i),
    flaws: i.conditionDescription,
    suggested_price: i.price,
    item_type: i.categoryName?.split(":").pop()?.trim() ?? null,
    description: i.descriptionHtml,
    photo_urls: i.pictures.slice(0, 24),
    thumbnail_url: i.pictures[0] ?? null,
    ebay_listing_id: i.itemId,
    store_category_id: i.storeCategoryId,
    item_specifics: { categoryId: i.categoryId, categoryPath: i.categoryName, aspects: i.specifics, measurements: [] },
    shipping_mode: "calculated",
  };
}
