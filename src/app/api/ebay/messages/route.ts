import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { fetchUnansweredQuestions } from "@/lib/ebay-messages";
import { fetchAllOfListType, isListTypeError, toListing } from "@/lib/ebay-listings";
import { lookupItems } from "@/lib/ebay-items";
import { fetchUnshippedOrders, type UnshippedOrder } from "@/lib/ebay-ship-orders";

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
      // Item details: eBay's message (title/price) -> active listings
      // (photo) -> GetItem for anything else (sold/ended), batched + cached.
      type Info = { title: string | null; thumbnail: string | null; price: number | null };
      const info = new Map<string, Info>();
      const withItem = questions.filter((q) => q.itemId);
      if (withItem.length) {
        const activeResult = await fetchAllOfListType("ActiveList");
        if (!isListTypeError(activeResult)) {
          for (const l of activeResult.items.map((item) => toListing(item, "active"))) {
            info.set(l.listingId, { title: l.title, thumbnail: l.thumbnail, price: l.price });
          }
        }
        const missing = [...new Set(withItem.map((q) => q.itemId as string))].filter((id) => !info.get(id)?.thumbnail).slice(0, 24);
        if (missing.length) {
          const looked = await lookupItems(missing);
          for (const [id, v] of looked) info.set(id, { title: info.get(id)?.title ?? v.title, thumbnail: v.thumbnail, price: info.get(id)?.price ?? v.price });
        }
      }

      // Messages with no listing attached (e.g. about a payment): show the
      // buyer's open order if there is one.
      const orderByBuyer = new Map<string, { itemId: string; title: string; thumbnail: string | null; price: number }>();
      if (questions.some((q) => !q.itemId)) {
        const orders = await fetchUnshippedOrders().catch(() => ({ items: [] as UnshippedOrder[] }));
        for (const o of orders.items) {
          if (o.buyerUserId && !orderByBuyer.has(o.buyerUserId.toLowerCase())) {
            orderByBuyer.set(o.buyerUserId.toLowerCase(), { itemId: o.listingId, title: o.title, thumbnail: o.galleryUrl, price: o.total });
          }
        }
      }

      const enriched = questions.map((q) => {
        if (q.itemId) {
          const i = info.get(q.itemId);
          return {
            ...q,
            title: q.itemTitle || i?.title || null,
            thumbnail: i?.thumbnail ?? null,
            price: q.itemPrice ?? i?.price ?? null,
            url: `https://www.ebay.com/itm/${q.itemId}`,
            context: "listing" as const,
          };
        }
        const o = orderByBuyer.get(q.senderId.toLowerCase());
        return o
          ? { ...q, title: o.title, thumbnail: o.thumbnail, price: o.price, url: `https://www.ebay.com/itm/${o.itemId}`, context: "order" as const }
          : { ...q, title: null, thumbnail: null, price: null, url: null, context: "general" as const };
      });

      return NextResponse.json({ questions: enriched });
    } catch (err) {
      console.error("GET /api/ebay/messages failed:", err);
      return NextResponse.json({ error: "Couldn't load buyer questions right now. Try refreshing in a moment." }, { status: 500 });
    }
  });
}
