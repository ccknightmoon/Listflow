import { NextRequest, NextResponse } from "next/server";
import type { PriceSuggestion, Condition } from "@/lib/pricing";

export const runtime = "nodejs";

const FINDING_BASE = "https://svcs.ebay.com/services/search/FindingService/v1";
const BROWSE_BASE = "https://api.ebay.com/buy/browse/v1";

const CONDITION_MULTIPLIER: Record<Condition, number> = {
  "New with tags": 1.5,
  "New without tags": 1.2,
  "Excellent used": 1.0,
  "Good - minor flaws": 0.78,
  "Fair - notable flaws": 0.55,
};

// Stop words and size tokens to exclude from keyword extraction
const STOP = new Set([
  "the", "a", "an", "and", "or", "for", "in", "on", "at", "to", "of", "with",
  "is", "it", "this", "that", "by", "from", "as", "are", "was", "be", "has",
  "new", "used", "lot", "buy", "now", "free", "fast", "shipping", "condition",
  "size", "small", "medium", "large", "extra", "petite", "plus",
  "xs", "sm", "xl", "xxl", "xxxl", "xlt", "2xl", "3xl", "tall",
  "men", "women", "mens", "womens", "unisex", "kids",
]);

// Module-level app token cache (reused across requests to same serverless instance)
let appTokenCache: { token: string; expires: number } | null = null;

async function getAppToken(): Promise<string> {
  if (appTokenCache && appTokenCache.expires > Date.now() + 60_000) {
    return appTokenCache.token;
  }
  const id = process.env.EBAY_CLIENT_ID!;
  const secret = process.env.EBAY_CLIENT_SECRET!;
  const creds = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`App token fetch failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  appTokenCache = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function searchByImage(imageBase64: string): Promise<string[]> {
  const token = await getAppToken();
  const res = await fetch(`${BROWSE_BASE}/item_summary/search_by_image?limit=10`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
    body: JSON.stringify({ image: imageBase64 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`searchByImage ${res.status}`);
  const data = (await res.json()) as { itemSummaries?: { title: string }[] };
  return (data.itemSummaries ?? []).map((item) => item.title).filter(Boolean);
}

function keywordsFromTitles(titles: string[], brand?: string): string {
  const wordCount: Record<string, number> = {};
  // Earlier results are more visually similar — weight them higher
  titles.forEach((title, ti) => {
    const weight = titles.length - ti;
    const words = title
      .toLowerCase()
      .split(/[\s\-\/,.()|&]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
    for (const word of new Set(words)) {
      wordCount[word] = (wordCount[word] ?? 0) + weight;
    }
  });

  const top = Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);

  // Prepend brand if not already captured
  if (brand && brand.toLowerCase() !== "unknown") {
    const bl = brand.toLowerCase();
    if (!top.some((w) => w.includes(bl) || bl.includes(w))) {
      top.unshift(brand);
    }
  }

  const result = top.slice(0, 5).join(" ");
  // Quality check: must have at least 2 meaningful words
  return result.split(/\s+/).filter((w) => w.length >= 3).length >= 2 ? result : "";
}

type EbayJson = Record<string, unknown>;

async function findingGet(operation: string, params: Record<string, string>): Promise<unknown> {
  const appId = process.env.EBAY_CLIENT_ID;
  if (!appId) throw new Error("EBAY_CLIENT_ID not configured");
  const url = new URL(FINDING_BASE);
  url.searchParams.set("OPERATION-NAME", operation);
  url.searchParams.set("SECURITY-APPNAME", appId);
  url.searchParams.set("RESPONSE-DATA-FORMAT", "JSON");
  url.searchParams.set("REST-PAYLOAD", "");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`eBay Finding API ${res.status}`);
  return res.json();
}

function extractItems(data: unknown, responseKey: string): EbayJson[] {
  try {
    const d = data as EbayJson;
    const resp = (d[responseKey] as EbayJson[])?.[0];
    const items = ((resp?.["searchResult"] as EbayJson[])?.[0]?.["item"]) as EbayJson[] | undefined;
    return items ?? [];
  } catch {
    return [];
  }
}

function itemPrice(item: EbayJson): number {
  try {
    const ss = (item["sellingStatus"] as EbayJson[])?.[0];
    const cp = (ss?.["currentPrice"] as EbayJson[])?.[0];
    return parseFloat((cp?.["__value__"] as string) ?? "0") || 0;
  } catch {
    return 0;
  }
}

function removeOutliers(prices: number[]): number[] {
  if (prices.length <= 4) return prices;
  const sorted = [...prices].sort((a, b) => a - b);
  const cut = Math.max(1, Math.floor(sorted.length * 0.1));
  return sorted.slice(cut, sorted.length - cut);
}

function buildKeywords(title: string, brand?: string): string {
  const titleWords = title.split(/\s+/).slice(0, 6).join(" ").trim();
  if (brand && brand.toLowerCase() !== "unknown" && !title.toLowerCase().includes(brand.toLowerCase())) {
    return `${brand} ${titleWords}`.trim();
  }
  return titleWords || title.trim();
}

export async function POST(req: NextRequest) {
  const { title, brand, condition, image } = (await req.json()) as {
    title: string;
    brand?: string;
    condition: Condition;
    image?: string; // base64, no data-URL prefix
  };

  if (!process.env.EBAY_CLIENT_ID) {
    return NextResponse.json({ error: "EBAY_CLIENT_ID not configured" }, { status: 500 });
  }

  // Determine search keywords: visual search if image provided, else AI title
  let keywords = buildKeywords(title, brand);
  if (image) {
    try {
      const visualTitles = await searchByImage(image);
      if (visualTitles.length >= 2) {
        const visualKeywords = keywordsFromTitles(visualTitles, brand);
        if (visualKeywords) keywords = visualKeywords;
      }
    } catch {
      // visual search failed — fall through to AI title keywords
    }
  }

  if (!keywords) {
    return NextResponse.json({ error: "No search keywords provided" }, { status: 400 });
  }

  const [soldRes, activeRes] = await Promise.allSettled([
    findingGet("findCompletedItems", {
      keywords,
      categoryId: "11450", // Clothing, Shoes & Accessories
      "itemFilter(0).name": "SoldItemsOnly",
      "itemFilter(0).value": "true",
      "paginationInput.entriesPerPage": "50",
      sortOrder: "EndTimeSoonest",
    }),
    findingGet("findItemsAdvanced", {
      keywords,
      categoryId: "11450",
      "itemFilter(0).name": "ListingType",
      "itemFilter(0).value": "FixedPrice",
      "paginationInput.entriesPerPage": "50",
    }),
  ]);

  const soldItems =
    soldRes.status === "fulfilled" ? extractItems(soldRes.value, "findCompletedItemsResponse") : [];
  const activeItems =
    activeRes.status === "fulfilled" ? extractItems(activeRes.value, "findItemsAdvancedResponse") : [];

  const rawSoldPrices = soldItems.map(itemPrice).filter((p) => p > 0);
  const activePrices = activeItems.map(itemPrice).filter((p) => p > 0);

  const filteredSold = removeOutliers(rawSoldPrices);
  const avgRaw =
    filteredSold.length > 0 ? filteredSold.reduce((s, p) => s + p, 0) / filteredSold.length : 0;

  const mult = CONDITION_MULTIPLIER[condition] ?? 1.0;
  const suggestedPrice = avgRaw > 0 ? Math.max(1, Math.round(avgRaw * mult)) : 0;
  const avgSold = avgRaw > 0 ? Math.round(avgRaw) : 0;

  const sortedActive = [...activePrices].sort((a, b) => a - b);
  const activeRangeLow =
    sortedActive.length > 0 ? Math.round(sortedActive[0]) : Math.round(suggestedPrice * 0.8) || 10;
  const activeRangeHigh =
    sortedActive.length > 0
      ? Math.round(sortedActive[sortedActive.length - 1])
      : Math.round(suggestedPrice * 1.3) || 40;

  const comparableSoldCount = filteredSold.length;
  const comparableActiveCount = activePrices.length;

  let sellOdds: PriceSuggestion["sellOdds"] = "Low";
  if (comparableSoldCount >= 10) sellOdds = "High";
  else if (comparableSoldCount >= 3) sellOdds = "Medium";

  if (activePrices.length > 0 && suggestedPrice > 0) {
    const activeMid = (activeRangeLow + activeRangeHigh) / 2;
    if (suggestedPrice > activeMid * 1.15 && sellOdds === "High") sellOdds = "Medium";
  }

  const result: PriceSuggestion = {
    suggestedPrice: suggestedPrice || 20,
    avgSold: avgSold || 20,
    activeRangeLow,
    activeRangeHigh,
    sellOdds,
    comparableSoldCount,
    comparableActiveCount,
  };

  return NextResponse.json(result);
}
