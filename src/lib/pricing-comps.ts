// Comparable ACTIVE eBay listings for one draft (Browse API, app token),
// summarized by src/lib/comp-weighting.ts. Read-only; suggestions only.
// Server only.
import { ebayHttps, getAppToken } from "@/lib/ebay-app-token";
import { summarizeComps, type Comp, type CompSummary, type CompTarget } from "@/lib/comp-weighting";

const HOST = "api.ebay.com";
const LIMIT = 50;

interface Summary {
  title?: string;
  price?: { value?: string };
  conditionId?: string;
  itemWebUrl?: string;
  shippingOptions?: { shippingCostType?: string; shippingCost?: { value?: string } }[];
}

export function compsFromBrowse(data: { itemSummaries?: Summary[] }): Comp[] {
  return (data.itemSummaries ?? [])
    .map((s) => {
      const ship = s.shippingOptions?.[0];
      const shipCost = ship?.shippingCost?.value != null ? parseFloat(ship.shippingCost.value) : null;
      return {
        title: s.title ?? "",
        price: parseFloat(s.price?.value ?? "0") || 0,
        // FIXED + 0 = free shipping; CALCULATED without a cost = unknown.
        shipping: shipCost != null && Number.isFinite(shipCost) ? shipCost : null,
        conditionId: s.conditionId ?? null,
        url: s.itemWebUrl ?? null,
      };
    })
    .filter((c) => c.title && c.price > 0);
}

/** First ~6 title words, brand in front if missing (same idea as pricing-suggest). */
export function compQuery(title: string, brand?: string | null): string {
  const words = title.replace(/[^\p{L}\p{N}\s'&-]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  const b = brand && !/^unknown|unbranded$/i.test(brand) ? brand.trim() : "";
  const q = b && !words.toLowerCase().includes(b.toLowerCase()) ? `${b} ${words}` : words;
  return q.slice(0, 100).trim();
}

async function browse(path: string, init: { method: "GET" | "POST"; body?: string }): Promise<Comp[]> {
  const token = await getAppToken();
  const { status, body } = await ebayHttps(
    {
      hostname: HOST,
      path,
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        ...(init.body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(init.body) } : {}),
      },
    },
    init.body
  );
  if (status !== 200) throw new Error(`Browse ${status}`);
  return compsFromBrowse(JSON.parse(body));
}

export async function findComps(target: CompTarget & { imageBase64?: string }): Promise<{ summary: CompSummary | null; query: string }> {
  const query = compQuery(target.title, target.brand);
  const tasks: Promise<Comp[]>[] = [];
  if (query) {
    const params = new URLSearchParams({ q: query, limit: String(LIMIT), category_ids: "11450", filter: "buyingOptions:{FIXED_PRICE}" });
    tasks.push(browse(`/buy/browse/v1/item_summary/search?${params}`, { method: "GET" }).catch(() => []));
  }
  if (target.imageBase64) {
    tasks.push(browse(`/buy/browse/v1/item_summary/search_by_image?limit=${LIMIT}`, { method: "POST", body: JSON.stringify({ image: target.imageBase64 }) }).catch(() => []));
  }
  const all = (await Promise.all(tasks)).flat();
  const seen = new Set<string>();
  const unique = all.filter((c) => {
    const k = c.url ?? `${c.title}|${c.price}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { summary: summarizeComps(unique, target), query };
}
