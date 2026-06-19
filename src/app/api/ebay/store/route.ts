import { NextResponse } from "next/server";
import { tradingRequest } from "@/lib/ebay-inventory";

export const runtime = "nodejs";

function xmlFind(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m?.[1]?.trim() ?? "";
}

function extractItemBlocks(xml: string): string[] {
  const arrayBlock = xmlFind(xml, "ItemArray");
  if (!arrayBlock) return [];
  const items: string[] = [];
  const re = /<Item[^>]*>([\s\S]*?)<\/Item>/g;
  let m;
  while ((m = re.exec(arrayBlock)) !== null) items.push(m[1]);
  return items;
}

async function fetchPage(page: number) {
  return tradingRequest(
    "GetMyeBaySelling",
    `<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList><DetailLevel>ReturnSummary</DetailLevel></GetMyeBaySellingRequest>`
  );
}

export async function GET() {
  try {
    const { status, body } = await fetchPage(1);

    if (status >= 400) {
      return NextResponse.json(
        { error: `Trading API HTTP ${status}: ${body.slice(0, 300)}` },
        { status: 502 }
      );
    }

    if (body.includes("<Ack>Failure</Ack>")) {
      const errMsg =
        body.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/)?.[1] ??
        body.match(/<ShortMessage>([\s\S]*?)<\/ShortMessage>/)?.[1] ??
        body.slice(0, 300);
      return NextResponse.json({ error: `eBay error: ${errMsg}` }, { status: 502 });
    }

    const totalStr = xmlFind(body, "TotalNumberOfEntries");
    const total = parseInt(totalStr || "0", 10);

    const items = extractItemBlocks(body);
    const listings = items.map((item) => {
      const listingId = xmlFind(item, "ItemID");
      const title = xmlFind(item, "Title") || "Untitled";
      const priceStr = xmlFind(item, "CurrentPrice");
      const price = priceStr ? parseFloat(priceStr) : null;
      const thumbnail = xmlFind(item, "GalleryURL") || null;
      const sku = xmlFind(item, "SKU") || null;
      return { listingId, title, price, thumbnail, sku };
    });

    return NextResponse.json({ listings, total: total || listings.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
