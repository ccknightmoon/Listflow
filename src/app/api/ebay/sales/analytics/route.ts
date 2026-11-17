import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { EBAY_STANDARD_FEE_PERCENT, isValidFeePercent } from "@/lib/ebay-fees";
import { buildSalesFeed } from "@/lib/sales-feed";
import { getCachedSalesFeed, setCachedSalesFeed } from "@/lib/sales-feed-cache";

export const runtime = "nodejs";
// One heavier load (~6 months of eBay data), then every tab switch is local.
export const maxDuration = 60;

// Short per-user server cache so reopening the page (or another device)
// doesn't re-pull six months from eBay. ?refresh=1 (the page's refresh
// button) bypasses it. In-flight requests are shared.
const inflight = new Map<string, Promise<unknown>>();

export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase, user } = auth;

  const connection = await requireEbayConnection(auth);
  if (!connection) {
    return NextResponse.json({ error: "eBay not connected.", connect: true, reconnect: false }, { status: 200 });
  }
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const hit = refresh ? null : getCachedSalesFeed(user.id);
  if (hit) return NextResponse.json({ ...hit, cached: true });

  return ebayContext.run(connection, async () => {
    try {
      const { data: settingsRow } = await supabase
        .from("app_settings")
        .select("ebay_fee_percent_override")
        .eq("user_id", user.id)
        .maybeSingle();
      const feePercent = isValidFeePercent(settingsRow?.ebay_fee_percent_override)
        ? settingsRow.ebay_fee_percent_override
        : EBAY_STANDARD_FEE_PERCENT;

      let pending = inflight.get(user.id) as ReturnType<typeof buildSalesFeed> | undefined;
      if (!pending) {
        pending = buildSalesFeed(supabase, feePercent);
        inflight.set(user.id, pending);
        pending.finally(() => inflight.delete(user.id)).catch(() => {});
      }
      const feed = await pending;
      if ("error" in feed) {
        return NextResponse.json({ error: feed.error, connect: false, reconnect: feed.reconnect }, { status: 200 });
      }
      setCachedSalesFeed(user.id, feed);
      return NextResponse.json(feed);
    } catch (err) {
      console.error("GET /api/ebay/sales/analytics failed:", err);
      return NextResponse.json(
        { error: "Couldn't load sales right now. Try refreshing -- if it keeps happening, reconnect eBay in Settings." },
        { status: 500 },
      );
    }
  });
}
