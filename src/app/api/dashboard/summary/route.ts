import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { getDashboardSummary } from "@/lib/dashboard-summary";
import { peekSalesFeed } from "@/lib/sales-feed-cache";
import { homeSalesFromFeed } from "@/lib/home-week";

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
    // If this server already holds the Sales page's feed, send its last few
    // days too: Home then computes "Last 7 days" from exactly the data and
    // dates the Sales page uses (never calls eBay for it).
    const feed = peekSalesFeed(auth.user.id);
    const weekSales = feed ? homeSalesFromFeed(feed.sales, Date.now()) : null;
    return NextResponse.json({ connected: true, drafts, ...summary, weekSales }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
