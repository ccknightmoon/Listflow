import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { fetchEligibleListingIds, isValidOfferDiscount, sendOfferToInterestedBuyers } from "@/lib/watcher-offers";

export const runtime = "nodejs";

const cache = new Map<string, { at: number; ids: string[] }>();
const TTL = 10 * 60_000;

// GET: which listings have interested buyers eBay will let you send an offer to.
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const hit = cache.get(auth.user.id);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json({ eligible: hit.ids, available: true });
  const connection = await requireEbayConnection(auth);
  if (!connection) return NextResponse.json({ eligible: [], available: false });
  return ebayContext.run(connection, async () => {
    const ids = await fetchEligibleListingIds().catch(() => null);
    if (!ids) return NextResponse.json({ eligible: [], available: false });
    cache.set(auth.user!.id, { at: Date.now(), ids: [...ids] });
    return NextResponse.json({ eligible: [...ids], available: true });
  });
}

// POST { listingId, discountPercentage, message? }: send the offer (2-day expiry).
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  let body: { listingId?: unknown; discountPercentage?: unknown; message?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const listingId = typeof body.listingId === "string" && /^\d{6,15}$/.test(body.listingId) ? body.listingId : null;
  if (!listingId || !isValidOfferDiscount(body.discountPercentage)) {
    return NextResponse.json({ error: "Pick a listing and a discount between 5% and 80%." }, { status: 400 });
  }
  const connection = await requireEbayConnection(auth);
  if (!connection) return NextResponse.json({ error: "eBay not connected.", connect: true }, { status: 200 });
  return ebayContext.run(connection, async () => {
    const r = await sendOfferToInterestedBuyers(listingId, body.discountPercentage as number, typeof body.message === "string" ? body.message : undefined);
    if (!r.ok) {
      const needsReconnect = r.status === 401 || r.status === 403;
      return NextResponse.json({
        error: needsReconnect ? "eBay needs permission for offers — reconnect eBay in Settings, then try again." : r.error,
        reconnect: needsReconnect,
      }, { status: 200 });
    }
    cache.delete(auth.user!.id);
    return NextResponse.json({ success: true, sent: r.sent });
  });
}
