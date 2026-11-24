import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { EBAY_STANDARD_FEE_PERCENT, isValidFeePercent } from "@/lib/ebay-fees";
import { buildSalesFeed } from "@/lib/sales-feed";
import { getSalesFeed } from "@/lib/sales-feed-cache";

export const runtime = "nodejs";
// One heavier load (~6 months of eBay data), then every tab switch is local.
export const maxDuration = 60;

// Per-user stale-while-revalidate cache (src/lib/sales-feed-cache.ts):
// reopening the page is instant; data older than 3 minutes comes back with
// `stale: true` while one rebuild runs, and the page then asks again with
// ?maxAge=… to wait for the fresh copy. ?refresh=1 (refresh button) forces
// a rebuild.
export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase, user } = auth;

  const connection = await requireEbayConnection(auth);
  if (!connection) {
    return NextResponse.json({ error: "eBay not connected.", connect: true, reconnect: false }, { status: 200 });
  }
  const sp = new URL(req.url).searchParams;
  const force = sp.get("refresh") === "1";
  const maxAgeRaw = Number(sp.get("maxAge"));
  const maxAgeMs = Number.isFinite(maxAgeRaw) && maxAgeRaw > 0 ? maxAgeRaw * 1000 : undefined;

  const build = () =>
    ebayContext.run(connection, async () => {
      const { data: settingsRow } = await supabase
        .from("app_settings")
        .select("ebay_fee_percent_override")
        .eq("user_id", user.id)
        .maybeSingle();
      const feePercent = isValidFeePercent(settingsRow?.ebay_fee_percent_override)
        ? settingsRow.ebay_fee_percent_override
        : EBAY_STANDARD_FEE_PERCENT;
      return buildSalesFeed(supabase, feePercent);
    });

  try {
    const r = await getSalesFeed(user.id, build, { force, maxAgeMs });
    const feed = r.value;
    if ("error" in feed) {
      return NextResponse.json({ error: feed.error, connect: false, reconnect: feed.reconnect }, { status: 200 });
    }
    return NextResponse.json({ ...feed, stale: r.stale }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("GET /api/ebay/sales/analytics failed:", err);
    return NextResponse.json(
      { error: "Couldn't load sales right now. Try refreshing -- if it keeps happening, reconnect eBay in Settings." },
      { status: 500 },
    );
  }
}
