import { NextRequest, NextResponse } from "next/server";
import https from "node:https";
import type { PriceSuggestion, Condition } from "@/lib/pricing";

export const runtime = "nodejs";

const BROWSE_BASE_HOST = "api.ebay.com";
const BROWSE_BASE_PATH = "/buy/browse/v1";

const CONDITION_MULTIPLIER: Record<Condition, number> = {
  "New with tags": 1.5,
  "New without tags": 1.2,
  "Excellent used": 1.0,
  "Good - minor flaws": 0.78,
  "Fair - notable flaws": 0.55,
};

const STOP = new Set([
  "the", "a", "an", "and", "or", "for", "in", "on", "at", "to", "of", "with",
  "is", "it", "this", "that", "by", "from", "as", "are", "was", "be", "has",
  "new", "used", "lot", "buy", "now", "free", "fast", "shipping", "condition",
  "size", "small", "medium", "large", "extra", "petite", "plus",
  "xs", "sm", "xl", "xxl", "xxxl", "xlt", "2xl", "3xl", "tall",
  "men", "women", "mens", "womens", "unisex", "kids",
]);

let appTokenCache: { token: string; expires: number } | null = null;

function httpsRequest(options: https.RequestOptions, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => { data += c.toString(); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(10_000, () => { req.destroy(new Error("Request timeout")); });
    if (body) req.write(body);
    req.end();
  });
}

async function getAppToken(): Promise<string> {
  if (appTokenCache && appTokenCache.expires > Date.now() + 60_000) {
    return appTokenCache.token;
  }
  const id = process.env.EBAY_CLIENT_ID!;
  const secret = process.env.EBAY_CLIENT_SECRET!;
  const creds = Buffer.from(`${id}:${secret}`).toString("base64");
  const body = "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope";
  const buf = Buffer.from(body, "utf-8");

  const { status, body: resBody } = await httpsRequest(
    {
      hostname: BROWSE_BASE_HOST,
      path: "/identity/v1/oauth2/token",
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": buf.length,
      },
    },
    body
  );
  if (status !== 200) throw new Error(`App token fetch failed: ${status} ${resBody.slice(0, 200)}`);
  const data = JSON.parse(resBody) as { access_token: string; expires_in: number };
  appTokenCache = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

interface BrowseItem {
  title: string;
  price: number;
}

async function searchByImage(imageBase64: string): Promise<BrowseItem[]> {
  const token = await getAppToken();
  const bodyStr = JSON.stringify({ image: imageBase64 });
  const buf = Buffer.from(bodyStr, "utf-8");

  const { status, body } = await httpsRequest(
    {
      hostname: BROWSE_BASE_HOST,
      path: `${BROWSE_BASE_PATH}/item_summary/search_by_image?limit=20`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": buf.length,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    },
    bodyStr
  );
  if (status !== 200) throw new Error(`searchByImage ${status}`);
  const data = JSON.parse(body) as {
    itemSummaries?: { title?: string; price?: { value?: string } }[];
  };
  return (data.itemSummaries ?? [])
    .map((item) => ({
      title: item.title ?? "",
      price: parseFloat(item.price?.value ?? "0") || 0,
    }))
    .filter((item) => item.title);
}

async function searchByText(keywords: string): Promise<BrowseItem[]> {
  const token = await getAppToken();
  const params = new URLSearchParams({
    q: keywords,
    limit: "20",
    category_ids: "11450",
    filter: "buyingOptions:{FIXED_PRICE}",
  });
  const path = `${BROWSE_BASE_PATH}/item_summary/search?${params.toString()}`;

  const { status, body } = await httpsRequest({
    hostname: BROWSE_BASE_HOST,
    path,
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });
  if (status !== 200) throw new Error(`Browse search ${status}`);
  const data = JSON.parse(body) as {
    itemSummaries?: { title?: string; price?: { value?: string } }[];
  };
  return (data.itemSummaries ?? [])
    .map((item) => ({
      title: item.title ?? "",
      price: parseFloat(item.price?.value ?? "0") || 0,
    }))
    .filter((item) => item.title);
}

function keywordsFromTitles(titles: string[], brand?: string): string {
  const wordCount: Record<string, number> = {};
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
  if (brand && brand.toLowerCase() !== "unknown") {
    const bl = brand.toLowerCase();
    if (!top.some((w) => w.includes(bl) || bl.includes(w))) {
      top.unshift(brand);
    }
  }
  const result = top.slice(0, 5).join(" ");
  return result.split(/\s+/).filter((w) => w.length >= 3).length >= 2 ? result : "";
}

function buildKeywords(title: string, brand?: string): string {
  const titleWords = title.split(/\s+/).slice(0, 6).join(" ").trim();
  if (brand && brand.toLowerCase() !== "unknown" && !title.toLowerCase().includes(brand.toLowerCase())) {
    return `${brand} ${titleWords}`.trim();
  }
  return titleWords || title.trim();
}

function removeOutliers(prices: number[]): number[] {
  if (prices.length <= 4) return prices;
  const sorted = [...prices].sort((a, b) => a - b);
  const cut = Math.max(1, Math.floor(sorted.length * 0.1));
  return sorted.slice(cut, sorted.length - cut);
}

export async function POST(req: NextRequest) {
  const { title, brand, condition, image } = (await req.json()) as {
    title: string;
    brand?: string;
    condition: Condition;
    image?: string;
  };

  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    return NextResponse.json({ error: "eBay credentials not configured" }, { status: 500 });
  }

  let keywords = buildKeywords(title, brand);
  let items: BrowseItem[] = [];

  if (image) {
    try {
      const visualItems = await searchByImage(image);
      if (visualItems.length >= 2) {
        const visualKeywords = keywordsFromTitles(visualItems.map((i) => i.title), brand);
        if (visualKeywords) keywords = visualKeywords;
        items = visualItems;
      }
    } catch {
      // visual search failed — fall through to text search
    }
  }

  if (items.length === 0 && keywords) {
    try {
      items = await searchByText(keywords);
    } catch {
      // text search failed
    }
  }

  const activePrices = items.map((i) => i.price).filter((p) => p > 0);
  const filtered = removeOutliers(activePrices);
  const sorted = [...filtered].sort((a, b) => a - b);
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;

  const mult = CONDITION_MULTIPLIER[condition] ?? 1.0;
  const suggestedPrice = median > 0 ? Math.max(1, Math.round(median * mult * 0.95)) : 0;

  const allSorted = [...activePrices].sort((a, b) => a - b);
  const activeRangeLow = allSorted.length > 0 ? Math.round(allSorted[0]) : 0;
  const activeRangeHigh = allSorted.length > 0 ? Math.round(allSorted[allSorted.length - 1]) : 0;
  const comparableActiveCount = activePrices.length;
  const noData = comparableActiveCount === 0;

  let sellOdds: PriceSuggestion["sellOdds"] = "Low";
  if (comparableActiveCount >= 20) sellOdds = "High";
  else if (comparableActiveCount >= 5) sellOdds = "Medium";

  const result: PriceSuggestion = {
    suggestedPrice,
    avgSold: Math.round(median),
    activeRangeLow,
    activeRangeHigh,
    sellOdds,
    comparableSoldCount: 0,
    comparableActiveCount,
    ...(noData ? { noData: true } : {}),
  };

  return NextResponse.json(result);
}
