import { NextResponse } from "next/server";
import { tradingRequest } from "@/lib/ebay-inventory";

export const runtime = "nodejs";

function extract(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m?.[1]?.trim() ?? "";
}

function extractAll(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const results: string[] = [];
  let m;
  while ((m = regex.exec(xml)) !== null) results.push(m[1]);
  return results;
}

export async function GET() {
  try {
    const xml = await tradingRequest(
      "GetMyeBaySelling",
      `<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination></ActiveList><DetailLevel>ReturnAll</DetailLevel></GetMyeBaySellingRequest>`
    );

    if (!xml.includes("<Ack>Success</Ack>") && !xml.includes("<Ack>Warning</Ack>")) {
      const errMsg = extract(xml, "LongMessage") || extract(xml, "ShortMessage") || xml.slice(0, 500) || "Failed to fetch eBay listings";
      return NextResponse.json({ error: errMsg }, { status: 400 });
    }

    const itemArrayMatch = xml.match(/<ItemArray>([\s\S]*?)<\/ItemArray>/);
    const itemsXml = itemArrayMatch?.[1] ?? "";
    const itemBlocks = extractAll(itemsXml, "Item");

    const listings = itemBlocks.map((item) => ({
      listingId: extract(item, "ItemID"),
      title: extract(item, "Title"),
      price: extract(item, "CurrentPrice"),
      gallery: extract(item, "GalleryURL"),
      endTime: extract(item, "EndTime"),
      quantity: extract(item, "Quantity"),
      quantitySold: extract(item, "QuantitySold"),
    }));

    return NextResponse.json({ listings, total: listings.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
