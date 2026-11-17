// Look up eBay items by ItemID (title, photo, price, listing URL), in small
// parallel batches with a per-instance cache -- used where eBay's own
// responses don't carry those fields (e.g. buyer messages).
import { tradingRequest } from "./ebay-inventory";
import { xmlFind } from "./sales-parse";
import { decodeEntities } from "./html-entities";

export interface ItemSummary {
  itemId: string;
  title: string | null;
  thumbnail: string | null;
  price: number | null;
  url: string;
}

const ID_RE = /^\d{6,15}$/;
const TTL = 6 * 60 * 60_000;
const cache = new Map<string, { at: number; v: ItemSummary }>();

export function parseGetItem(itemId: string, body: string): ItemSummary {
  const ok = body.includes("<Ack>Success</Ack>") || body.includes("<Ack>Warning</Ack>");
  const pd = ok ? xmlFind(body, "PictureDetails") : "";
  const priceStr = ok ? xmlFind(xmlFind(body, "SellingStatus"), "CurrentPrice") || xmlFind(body, "StartPrice") : "";
  const price = priceStr ? parseFloat(priceStr) : NaN;
  return {
    itemId,
    title: ok ? decodeEntities(xmlFind(body, "Title")) || null : null,
    thumbnail: ok ? xmlFind(pd, "GalleryURL") || xmlFind(pd, "PictureURL") || null : null,
    price: Number.isFinite(price) ? price : null,
    url: `https://www.ebay.com/itm/${itemId}`,
  };
}

export async function lookupItems(ids: string[], concurrency = 5): Promise<Map<string, ItemSummary>> {
  const out = new Map<string, ItemSummary>();
  const todo: string[] = [];
  for (const id of new Set(ids)) {
    if (!ID_RE.test(id)) continue;
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < TTL) out.set(id, hit.v);
    else todo.push(id);
  }
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const id = todo[i++];
      try {
        const { body } = await tradingRequest(
          "GetItem",
          `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${id}</ItemID><OutputSelector>Item.ItemID,Item.Title,Item.PictureDetails,Item.SellingStatus.CurrentPrice,Item.StartPrice</OutputSelector></GetItemRequest>`,
        );
        const v = parseGetItem(id, body);
        if (v.title || v.thumbnail) cache.set(id, { at: Date.now(), v });
        out.set(id, v);
      } catch {
        out.set(id, { itemId: id, title: null, thumbnail: null, price: null, url: `https://www.ebay.com/itm/${id}` });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, () => worker()));
  return out;
}
