import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { fetchPendingOffers } from "@/lib/ebay-offers";

export const runtime = "nodejs";

// The actual offers-lookup logic (worker-pool GetBestOffers calls across
// every active listing) now lives in src/lib/ebay-offers.ts, shared with
// the daily-digest cron -- this route is just the HTTP wrapper around it,
// same pattern as messages/route.ts around ebay-messages.ts.
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  const connection = await requireEbayConnection(auth);
  if (!connection) {
    // 200, not 502 -- apiFetch() (src/lib/api.ts) throws on any non-ok
    // status and discards the parsed body doing so, so this page's own
    // needsConnect/needsReconnect handling never ran on a hard-error
    // status. Matches the shape /api/ebay/sales and /api/ebay/ship use.
    return NextResponse.json({ error: "eBay not connected.", connect: true, reconnect: false }, { status: 200 });
  }

  return ebayContext.run(connection, async () => {
    try {
      const result = await fetchPendingOffers();
      if ("error" in result) {
        // Same reasoning as the not-connected check above.
        return NextResponse.json(result, { status: 200 });
      }
      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
