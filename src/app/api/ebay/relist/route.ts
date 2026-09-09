import { NextRequest, NextResponse } from "next/server";
import { relistItemByListingId, isValidEbayItemId } from "@/lib/ebay-inventory";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";

export const runtime = "nodejs";

// Relists an ended, unsold listing (Store page's "Ended" tab) as a new
// active one via Trading API RelistFixedPriceItem. Mirrors delist/route.ts's
// auth/connection/validation shape exactly -- this is the same kind of
// direct-by-listing-ID Trading API action, just the opposite direction.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  const connection = await requireEbayConnection(auth);
  if (!connection) {
    return NextResponse.json({ error: "eBay not connected. Authorize your account first.", connect: true }, { status: 400 });
  }

  return ebayContext.run(connection, async () => {
    try {
      const body = await req.json();
      const { listingId } = body as { listingId?: string };

      if (!listingId) return NextResponse.json({ error: "listingId required" }, { status: 400 });
      if (!isValidEbayItemId(listingId)) {
        return NextResponse.json({ error: "Invalid eBay listing ID" }, { status: 400 });
      }

      const result = await relistItemByListingId(listingId);
      if (!result.success) {
        return NextResponse.json({ error: `eBay relist failed: ${result.error || "(empty response)"}` }, { status: 400 });
      }

      return NextResponse.json({ success: true, newListingId: result.newItemId });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
