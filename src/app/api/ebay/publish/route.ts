import { NextRequest, NextResponse } from "next/server";
import { publishOffer } from "@/lib/ebay-inventory";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { offerId } = await req.json();
    if (!offerId) return NextResponse.json({ error: "offerId required" }, { status: 400 });

    const result = await publishOffer(offerId);
    if (result.status >= 400) {
      const errData = result.data as { errors?: Array<{ longMessage?: string; message?: string }> };
      const msg = errData.errors?.[0]?.longMessage ?? errData.errors?.[0]?.message ?? "Failed to publish";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const listingId = (result.data as { listingId?: string }).listingId;
    return NextResponse.json({ success: true, listingId, url: `https://www.ebay.com/itm/${listingId}` });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
