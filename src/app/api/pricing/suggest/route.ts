import { NextRequest, NextResponse } from "next/server";
import type { PriceSuggestion, Condition } from "@/lib/pricing";

export const runtime = "nodejs";

const FINDING_BASE = "https://svcs.ebay.com/services/search/FindingService/v1";

const CONDITION_MULTIPLIER: Record<Condition, number> = {
  "New with tags": 1.5,
  "New without tags": 1.2,
  "Excellent used": 1.0,
  "Good - minor flaws": 0.78,
  "Fair - notable flaws": 0.55,
};

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
    return parseFloat(cp?.["__value__"] as string ?? "0") || 0;
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
  if (
    brand &&
    brand.toLowerCase() !== "unknown" &&
    !title.toLowerCase().includes(brand.toLowerCase())
  ) {
    return `${brand} ${titleWords}`.trim();
  }
  return titleWords || title.trim();
}

export async function POST(req: NextRequest) {
  const { title, brand, condition } = (await req.json()) as {
    title: string;
    brand?: string;
    condition: Condition;
  };

  if (!process.env.EBAY_CLIENT_ID) {
    return NextResponse.json({ error: "EBAY_CLIENT_ID not configured" }, { status: 500 });
  }

  const keywords = buildKeywords(title, brand);
  if (!keywords) {
    return NextResponse.json({ error: "No search keywords provided" }, { status: 400 });
  }

  const [soldRes, activeRes] = await Promise.allSettled([
    findingGet("findCompletedItems", {
      keywords,
      "itemFilter(0).name": "SoldItemsOnly",
      "itemFilter(0).value": "true",
      "paginationInput.entriesPerPage": "50",
      sortOrder: "EndTimeSoonest",
    }),
    findingGet("findItemsAdvanced", {
      keywords,
      "itemFilter(0).name": "ListingType",
      "itemFilter(0).value": "FixedPrice",
      "paginationInput.entriesPerPage": "50",
    }),
  ]);

  const soldItems =
    soldRes.status === "fulfilled"
      ? extractItems(soldRes.value, "findCompletedItemsResponse")
      : [];
  const activeItems =
    activeRes.status === "fulfilled"
      ? extractItems(activeRes.value, "findItemsAdvancedResponse")
      : [];

  const rawSoldPrices = soldItems.map(itemPrice).filter((p) => p > 0);
  const activePrices = activeItems.map(itemPrice).filter((p) => p > 0);

  const filteredSold = removeOutliers(rawSoldPrices);
  const avgRaw =
    filteredSold.length > 0
      ? filteredSold.reduce((s, p) => s + p, 0) / filteredSold.length
      : 0;

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
