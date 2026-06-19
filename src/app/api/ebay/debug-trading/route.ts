import { NextResponse } from "next/server";
import { tradingRequest } from "@/lib/ebay-inventory";

export const runtime = "nodejs";

// Temporary debug endpoint — returns raw Trading API response
export async function GET() {
  try {
    const { status, body } = await tradingRequest(
      "GetMyeBaySelling",
      `<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ActiveList><Include>true</Include><Pagination><EntriesPerPage>5</EntriesPerPage><PageNumber>1</PageNumber></Pagination></ActiveList></GetMyeBaySellingRequest>`
    );
    return NextResponse.json({ status, body: body.slice(0, 3000) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
