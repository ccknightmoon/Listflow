import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { isUuid } from "@/lib/input-validation";
import { syncDraftWithEbay } from "@/lib/ebay-sync";

export const runtime = "nodejs";

// Called when the draft editor opens a listed draft (and by its "use eBay's
// version" button): re-reads the listing from eBay and refreshes the draft
// when only eBay changed. Returns the listing's fingerprint, which the
// editor sends back with "Update on eBay" for the conflict check.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  let body: { draftId?: unknown; useEbay?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!isUuid(body.draftId)) return NextResponse.json({ error: "draftId required" }, { status: 400 });
  const connection = await requireEbayConnection(auth);
  if (!connection) return NextResponse.json({ status: "error", error: "eBay not connected.", connect: true }, { status: 200 });
  try {
    const r = await ebayContext.run(connection, () => syncDraftWithEbay(auth.supabase, auth.user.id, body.draftId as string, { useEbay: body.useEbay === true }));
    return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ status: "error", error: (err as Error).message }, { status: 500 });
  }
}
