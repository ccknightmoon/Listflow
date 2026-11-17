import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-service";
import { decryptToken } from "@/lib/ebay-token-crypto";
import { ebayContext } from "@/lib/ebay-request-context";
import { fetchListPage } from "@/lib/ebay-listings";
import { xmlFind } from "@/lib/sales-parse";

export const runtime = "nodejs";
export const maxDuration = 60;

// Daily: record each seller's active-listing count (read-only eBay call),
// so sell-through for past periods is exact. Needs migration 026; returns
// a clear error until it's applied. Scheduled in vercel.json.
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected || req.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const supabase = getServiceClient();
  const { data: connections, error } = await supabase.from("ebay_connections").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const today = new Date().toISOString().slice(0, 10);
  const results: Array<{ userId: string; activeCount?: number; error?: string }> = [];
  for (const row of connections ?? []) {
    try {
      const connection = {
        userId: row.user_id,
        ebayUserId: row.ebay_user_id,
        refreshToken: decryptToken(row.encrypted_refresh_token),
        policies: {},
      };
      const { body } = await ebayContext.run(connection, () => fetchListPage("ActiveList", 1));
      if (!body.includes("<Ack>Success</Ack>") && !body.includes("<Ack>Warning</Ack>")) {
        results.push({ userId: row.user_id, error: "eBay error" });
        continue;
      }
      const activeCount = parseInt(xmlFind(xmlFind(body, "ActiveList"), "TotalNumberOfEntries") || xmlFind(body, "TotalNumberOfEntries") || "0", 10) || 0;
      const { error: upErr } = await supabase
        .from("active_listing_snapshots")
        .upsert({ user_id: row.user_id, snapshot_date: today, active_count: activeCount, captured_at: new Date().toISOString() });
      results.push(upErr ? { userId: row.user_id, error: upErr.message } : { userId: row.user_id, activeCount });
    } catch (e) {
      results.push({ userId: row.user_id, error: (e as Error).message });
    }
  }
  return NextResponse.json({ date: today, results });
}
