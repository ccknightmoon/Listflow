import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { getDashboardSummary } from "@/lib/dashboard-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Everything eBay-backed the Dashboard shows, in one request, cached per
// seller for ~2 minutes (see src/lib/dashboard-summary.ts). Draft counts
// stay on their own cheap Supabase routes.
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  // Unlisted draft count: Supabase only, always live (never cached).
  const { count } = await auth.supabase
    .from("drafts")
    .select("id", { count: "exact", head: true })
    .is("ebay_listing_id", null);
  const drafts = count ?? null;

  const connection = await requireEbayConnection(auth);
  if (!connection) {
    return NextResponse.json({ connected: false, drafts }, { headers: { "Cache-Control": "no-store" } });
  }

  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  try {
    const summary = await ebayContext.run(connection, () => getDashboardSummary(auth.user.id, fresh));
    return NextResponse.json({ connected: true, drafts, ...summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
