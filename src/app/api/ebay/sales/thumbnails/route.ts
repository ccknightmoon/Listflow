import { NextResponse } from "next/server";
import { tradingRequest } from "@/lib/ebay-inventory";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { xmlFind } from "@/lib/sales-parse";

export const runtime = "nodejs";

// Lazy photo lookup for sold items that have no Listflow draft. The Sales
// page asks only for the rows on screen (max 24 per call), instead of the
// old behaviour of up to 60 GetItem calls on every tab switch. Results are
// cached per server instance -- a sold listing's photo doesn't change.
const EBAY_ITEM_ID_RE = /^\d{6,15}$/;
const MAX_IDS = 24;
const CONCURRENCY = 5;
const TTL_MS = 6 * 60 * 60_000;
const cache = new Map<string, { at: number; url: string | null }>();

async function lookup(itemId: string): Promise<string | null> {
  const hit = cache.get(itemId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.url;
  let url: string | null = null;
  try {
    const { body } = await tradingRequest(
      "GetItem",
      `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${itemId}</ItemID><OutputSelector>PictureDetails</OutputSelector></GetItemRequest>`,
    );
    if (body.includes("<Ack>Success</Ack>") || body.includes("<Ack>Warning</Ack>")) {
      const pd = xmlFind(body, "PictureDetails");
      url = xmlFind(pd, "GalleryURL") || xmlFind(pd, "PictureURL") || null;
    }
  } catch {
    url = null;
  }
  cache.set(itemId, { at: Date.now(), url });
  return url;
}

export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const connection = await requireEbayConnection(auth);
  if (!connection) return NextResponse.json({ thumbnails: {} });

  const ids = [...new Set((new URL(req.url).searchParams.get("ids") ?? "").split(","))]
    .filter((id) => EBAY_ITEM_ID_RE.test(id))
    .slice(0, MAX_IDS);

  return ebayContext.run(connection, async () => {
    const out: Record<string, string | null> = {};
    let cursor = 0;
    async function worker() {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        out[id] = await lookup(id);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, () => worker()));
    return NextResponse.json({ thumbnails: out });
  });
}
