import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { fetchAllOfListType, isListTypeError, toListing } from "@/lib/ebay-listings";
import { sampleIds } from "@/lib/benchmark";

export const runtime = "nodejs";
export const maxDuration = 60;

// READ-ONLY. Picks N of the seller's active listings for the accuracy
// benchmark (evenly spread across the list). Nothing is changed on eBay.
export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const connection = await requireEbayConnection(auth);
  if (!connection) return NextResponse.json({ error: "eBay not connected." }, { status: 400 });
  const n = Math.max(1, Math.min(60, Number(new URL(req.url).searchParams.get("n")) || 40));
  return ebayContext.run(connection, async () => {
    const active = await fetchAllOfListType("ActiveList");
    if (isListTypeError(active)) return NextResponse.json({ error: active.error }, { status: 502 });
    const ids = active.items.map((x) => toListing(x, "active").listingId).filter(Boolean);
    return NextResponse.json({ total: ids.length, ids: sampleIds(ids, n) });
  });
}
