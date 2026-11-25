import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { fetchAllOfListType, isListTypeError, invalidateListingsAround, toListing } from "@/lib/ebay-listings";
import { findDraftListingMatches, type ReconcileDraft, type ReconcileListing } from "@/lib/draft-reconcile";
import { saveListingLink } from "@/lib/listing-link";

export const runtime = "nodejs";

// Drafts that are already on eBay (live or scheduled) but not linked.
// GET  -> the matches (read-only on eBay and in Listflow).
// POST { links: [{ draftId, listingId }] } -> links the ones the seller
//      confirmed, after re-checking each pair against eBay's current lists.
//      Linking only sets the item number: nothing is deleted, nothing is
//      changed on eBay. The draft then shows under Listings/Scheduled.

type Auth = Exclude<Awaited<ReturnType<typeof requireUser>>, { user: null }>;

async function loadState(auth: Auth) {
  const connection = await requireEbayConnection(auth);
  if (!connection) return { connect: true as const };
  return ebayContext.run(connection, async () => {
    const [active, scheduled] = await Promise.all([fetchAllOfListType("ActiveList"), fetchAllOfListType("ScheduledList")]);
    if (isListTypeError(active)) return { error: active.error, reconnect: active.reconnect };
    if (isListTypeError(scheduled)) return { error: scheduled.error, reconnect: scheduled.reconnect };
    const listings: ReconcileListing[] = [
      ...active.items.map((x) => ({ ...toListing(x, "active"), status: "active" as const })),
      ...scheduled.items.map((x) => ({ ...toListing(x, "active"), status: "scheduled" as const })),
    ]
      .filter((l) => l.listingId)
      .map((l) => ({ listingId: l.listingId, title: l.title, sku: l.sku, price: l.price, thumbnail: l.thumbnail, status: l.status }));

    const { data: drafts, error } = await auth.supabase
      .from("drafts")
      .select("id, title, custom_sku, ebay_listing_id")
      .eq("user_id", auth.user.id);
    if (error) return { error: error.message };
    const rows = drafts ?? [];
    const unlinked = rows.filter((d) => !d.ebay_listing_id) as ReconcileDraft[];
    const linked = rows.map((d) => d.ebay_listing_id as string | null).filter((x): x is string => !!x);
    return { listings, unlinked, linked };
  });
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  try {
    const s = await loadState(auth as Auth);
    if ("connect" in s && s.connect) return NextResponse.json({ matches: [], connect: true });
    if ("error" in s && s.error) return NextResponse.json({ matches: [], error: s.error, reconnect: s.reconnect ?? false });
    const { listings, unlinked, linked } = s as Exclude<typeof s, { connect: true } | { error: string }>;
    const matches = findDraftListingMatches(unlinked, listings, linked).map((m) => ({
      ...m,
      price: listings.find((l) => l.listingId === m.listingId)?.price ?? null,
      thumbnail: listings.find((l) => l.listingId === m.listingId)?.thumbnail ?? null,
    }));
    return NextResponse.json({ matches }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ matches: [], error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  let body: { links?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const wanted = (Array.isArray(body.links) ? body.links : [])
    .filter((l): l is { draftId: string; listingId: string } =>
      !!l && typeof l === "object" &&
      typeof (l as { draftId?: unknown }).draftId === "string" && /^[0-9a-f-]{36}$/i.test((l as { draftId: string }).draftId) &&
      typeof (l as { listingId?: unknown }).listingId === "string" && /^\d{9,15}$/.test((l as { listingId: string }).listingId))
    .slice(0, 200);
  if (!wanted.length) return NextResponse.json({ error: "Nothing to link." }, { status: 400 });

  try {
    const s = await loadState(auth as Auth);
    if ("connect" in s && s.connect) return NextResponse.json({ error: "eBay not connected.", connect: true });
    if ("error" in s && s.error) return NextResponse.json({ error: s.error, reconnect: s.reconnect ?? false });
    const { listings, unlinked, linked } = s as Exclude<typeof s, { connect: true } | { error: string }>;
    const onEbay = new Map(listings.map((l) => [l.listingId, l]));
    const unlinkedIds = new Set(unlinked.map((d) => d.id));
    const taken = new Set(linked);

    const linkedNow: string[] = [];
    const skipped: Array<{ draftId: string; reason: string }> = [];
    for (const w of wanted) {
      if (!unlinkedIds.has(w.draftId)) { skipped.push({ draftId: w.draftId, reason: "Not an unlinked draft of yours." }); continue; }
      const l = onEbay.get(w.listingId);
      if (!l) { skipped.push({ draftId: w.draftId, reason: "That listing isn't live or scheduled on eBay anymore." }); continue; }
      if (taken.has(w.listingId)) { skipped.push({ draftId: w.draftId, reason: "That listing is already linked to another draft." }); continue; }
      const r = await saveListingLink(auth.supabase, auth.user.id, w.draftId, w.listingId);
      if (r.ok) { linkedNow.push(w.draftId); taken.add(w.listingId); unlinkedIds.delete(w.draftId); }
      else skipped.push({ draftId: w.draftId, reason: r.error ?? "Couldn't save." });
    }
    invalidateListingsAround(auth.user.id);
    return NextResponse.json({ linked: linkedNow, skipped }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
