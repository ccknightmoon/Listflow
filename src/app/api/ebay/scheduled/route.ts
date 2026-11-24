import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { fetchAllOfListType, isListTypeError, xmlFind } from "@/lib/ebay-listings";
import { decodeEntities } from "@/lib/html-entities";

export const runtime = "nodejs";

// Scheduled listings on eBay (GetMyeBaySelling ScheduledList): ones made
// with "Finish on eBay" and ones scheduled in the eBay app, so they can be
// finished in either place. Read-only.
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const connection = await requireEbayConnection(auth);
  if (!connection) return NextResponse.json({ error: "eBay not connected.", connect: true }, { status: 200 });
  return ebayContext.run(connection, async () => {
    try {
      const r = await fetchAllOfListType("ScheduledList", { force: true });
      if (isListTypeError(r)) return NextResponse.json(r, { status: 200 });
      const items = r.items.map((it) => ({
        listingId: xmlFind(it, "ItemID"),
        title: decodeEntities(xmlFind(it, "Title")) || "Untitled",
        price: parseFloat(xmlFind(it, "CurrentPrice") || xmlFind(it, "StartPrice")) || null,
        thumbnail: xmlFind(it, "GalleryURL") || null,
        startTime: xmlFind(it, "StartTime") || null,
      })).filter((x) => x.listingId);
      const ids = items.map((i) => i.listingId);
      const links = new Map<string, string>();
      if (ids.length) {
        const { data } = await auth.supabase.from("drafts").select("id, ebay_listing_id").in("ebay_listing_id", ids.slice(0, 500));
        for (const d of data ?? []) links.set(d.ebay_listing_id as string, d.id as string);
      }
      return NextResponse.json({ items: items.map((i) => ({ ...i, draftId: links.get(i.listingId) ?? null })) }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
