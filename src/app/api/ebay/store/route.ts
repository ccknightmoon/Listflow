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
    // 200, not 502/4xx: apiFetch() (src/lib/api.ts) throws on any non-ok
    // status and discards the parsed body doing so -- this page's own
    // `if (data.error) { setNeedsConnect(...) }` handling never even ran
    // when this was a hard-error status, silently losing the "Connect
    // eBay" prompt. Matches the shape /api/ebay/sales and /api/ebay/ship
    // already use for the exact same condition.
    return NextResponse.json({ error: "eBay not connected.", connect: true, reconnect: false }, { status: 200 });
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
      // Same reasoning as the not-connected check above -- keep this a
      // 200 so the structured {error, connect, reconnect} body actually
      // reaches the page instead of apiFetch() throwing it away.
      return NextResponse.json(activeResult, { status: 200 });
    }

    const activeListings = activeResult.items.map((item) => toListing(item, "active"));
    const unsoldListings = isListTypeError(unsoldResult) ? [] : unsoldResult.items.map((item) => toListing(item, "ended"));

    // Join this seller's drafts (RLS-scoped) for the draft id and the item
    // cost they entered -- price cuts never go below cost.
    const all = [...activeListings, ...unsoldListings];
    const ids = all.map((l) => l.listingId).filter(Boolean);
    const draftInfo = new Map<string, { draftId: string; costBasis: number | null }>();
    // Draft links/costs in parallel batches (was one batch after another).
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += 200) batches.push(ids.slice(i, i + 200));
    const results = await Promise.all(batches.map((b) => auth.supabase.from("drafts").select("id, ebay_listing_id, cost_basis").in("ebay_listing_id", b)));
    for (const { data } of results) {
      for (const d of data ?? []) {
        draftInfo.set(d.ebay_listing_id as string, { draftId: d.id as string, costBasis: d.cost_basis == null ? null : Number(d.cost_basis) });
      }
    }

    return NextResponse.json({
      listings: all.map((l) => ({ ...l, draftId: draftInfo.get(l.listingId)?.draftId ?? null, costBasis: draftInfo.get(l.listingId)?.costBasis ?? null })),
      activeTotal: activeResult.total,
      unsoldTotal: isListTypeError(unsoldResult) ? 0 : unsoldResult.total,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  });
}
