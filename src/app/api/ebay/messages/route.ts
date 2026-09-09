import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { fetchUnansweredQuestions } from "@/lib/ebay-messages";
import { fetchAllOfListType, isListTypeError, toListing } from "@/lib/ebay-listings";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  const connection = await requireEbayConnection(auth);
  if (!connection) {
    return NextResponse.json({ error: "eBay not connected.", connect: true }, { status: 502 });
  }

  return ebayContext.run(connection, async () => {
    try {
      const { questions, error } = await fetchUnansweredQuestions();
      if (error) {
        console.error("GET /api/ebay/messages: eBay returned an error:", error);
        return NextResponse.json({ error: "Couldn't load buyer questions, try refreshing." }, { status: 502 });
      }

      // Attach title/thumbnail from active listings for any question that
      // has an item attached -- same cheap single-listing-page-fetch join
      // /api/ebay/offers already does, not a per-question API call.
      let titleByItemId = new Map<string, string>();
      let thumbnailByItemId = new Map<string, string | null>();
      if (questions.some((q) => q.itemId)) {
        const activeResult = await fetchAllOfListType("ActiveList");
        if (!isListTypeError(activeResult)) {
          const listings = activeResult.items.map((item) => toListing(item, "active"));
          titleByItemId = new Map(listings.map((l) => [l.listingId, l.title]));
          thumbnailByItemId = new Map(listings.map((l) => [l.listingId, l.thumbnail]));
        }
      }

      const enriched = questions.map((q) => ({
        ...q,
        title: q.itemId ? titleByItemId.get(q.itemId) ?? null : null,
        thumbnail: q.itemId ? thumbnailByItemId.get(q.itemId) ?? null : null,
      }));

      return NextResponse.json({ questions: enriched });
    } catch (err) {
      console.error("GET /api/ebay/messages failed:", err);
      return NextResponse.json({ error: "Couldn't load buyer questions, try refreshing." }, { status: 500 });
    }
  });
}
