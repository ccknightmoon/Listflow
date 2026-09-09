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
    // 200, not 502 -- apiFetch() (src/lib/api.ts) throws on any non-ok
    // status and discards the parsed body doing so, which meant this
    // page's needsConnect/needsReconnect handling never actually ran on
    // a hard-error status. Matches the shape /api/ebay/sales and
    // /api/ebay/ship already use for the same condition.
    return NextResponse.json({ error: "eBay not connected.", connect: true, reconnect: false }, { status: 200 });
  }

  return ebayContext.run(connection, async () => {
    try {
      const { questions, error, reconnect } = await fetchUnansweredQuestions();
      if (error) {
        console.error("GET /api/ebay/messages: eBay returned an error:", error);
        const friendlyError = reconnect
          ? "Your eBay connection needs to be refreshed. Go to Settings and tap Reconnect, then try again."
          : "Couldn't load buyer questions right now. Try refreshing in a moment.";
        return NextResponse.json({ error: friendlyError, connect: false, reconnect: !!reconnect }, { status: 200 });
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
      return NextResponse.json({ error: "Couldn't load buyer questions right now. Try refreshing in a moment." }, { status: 500 });
    }
  });
}
