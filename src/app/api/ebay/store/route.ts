import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
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
    const [activeResult, unsoldResult] = await Promise.all([
      fetchAllOfListType("ActiveList"),
      fetchAllOfListType("UnsoldList"),
    ]);

    // Active listings are the ones people depend on day to day — surface a
    // hard error if that call fails. If only Unsold fails, don't block the
    // whole page over it; just report zero ended listings.
    if (isListTypeError(activeResult)) {
      return NextResponse.json(activeResult, { status: 502 });
    }

    const activeListings = activeResult.items.map((item) => toListing(item, "active"));
    const unsoldListings = isListTypeError(unsoldResult) ? [] : unsoldResult.items.map((item) => toListing(item, "ended"));

    return NextResponse.json({
      listings: [...activeListings, ...unsoldListings],
      activeTotal: activeResult.total,
      unsoldTotal: isListTypeError(unsoldResult) ? 0 : unsoldResult.total,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  });
}
