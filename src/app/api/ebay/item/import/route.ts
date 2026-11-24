import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { importLiveItem } from "@/lib/ebay-item-import";

export const runtime = "nodejs";

// Open any active eBay listing (made in Listflow or in the eBay app) in
// Listflow's editor: returns the linked draft, creating it from GetItem
// when there isn't one yet. Read-only on eBay.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  let body: { itemId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const itemId = typeof body.itemId === "string" && /^\d{9,15}$/.test(body.itemId) ? body.itemId : null;
  if (!itemId) return NextResponse.json({ error: "itemId must be an eBay item number." }, { status: 400 });
  const connection = await requireEbayConnection(auth);
  if (!connection) return NextResponse.json({ error: "eBay not connected.", connect: true }, { status: 200 });
  try {
    const r = await ebayContext.run(connection, () => importLiveItem(auth.supabase, auth.user.id, itemId));
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
