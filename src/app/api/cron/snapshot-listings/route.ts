import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-service";
import { decryptToken } from "@/lib/ebay-token-crypto";
import { ebayContext } from "@/lib/ebay-request-context";
import { fetchListPage } from "@/lib/ebay-listings";
import { xmlFind } from "@/lib/sales-parse";
import { fetchEbayIdentity, storeEbayIdentity } from "@/lib/ebay-identity";

export const runtime = "nodejs";
export const maxDuration = 60;

// Daily: record each seller's active-listing count (read-only eBay call),
// so sell-through for past periods is exact. Needs migration 026; returns
// a clear error until it's applied. Scheduled in vercel.json.
const CONCURRENCY = 5;

type ConnectionRow = { user_id: string; ebay_user_id: string | null; ebay_eias_token?: string | null; encrypted_refresh_token: string };

async function snapshotOne(
  supabase: ReturnType<typeof getServiceClient>,
  row: ConnectionRow,
  today: string,
): Promise<{ userId: string; activeCount?: number; error?: string }> {
  try {
    const connection = {
      userId: row.user_id,
      ebayUserId: row.ebay_user_id,
      refreshToken: decryptToken(row.encrypted_refresh_token),
      policies: {},
    };
    const { body } = await ebayContext.run(connection, () => fetchListPage("ActiveList", 1));
    // Backfill which eBay user this connection is (needed to match eBay's
    // account-deletion notifications); one read-only call, once per seller.
    if (!row.ebay_user_id || (row.ebay_eias_token === null && "ebay_eias_token" in row)) {
      await ebayContext.run(connection, fetchEbayIdentity)
        .then((id) => storeEbayIdentity(supabase, row.user_id, id))
        .catch(() => {});
    }
    if (!body.includes("<Ack>Success</Ack>") && !body.includes("<Ack>Warning</Ack>")) {
      return { userId: row.user_id, error: "eBay error" };
    }
    const activeCount = parseInt(xmlFind(xmlFind(body, "ActiveList"), "TotalNumberOfEntries") || xmlFind(body, "TotalNumberOfEntries") || "0", 10) || 0;
    const { error: upErr } = await supabase
      .from("active_listing_snapshots")
      .upsert({ user_id: row.user_id, snapshot_date: today, active_count: activeCount, captured_at: new Date().toISOString() });
    return upErr ? { userId: row.user_id, error: upErr.message } : { userId: row.user_id, activeCount };
  } catch (e) {
    return { userId: row.user_id, error: (e as Error).message };
  }
}

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
  // Every connected seller, a few at a time (each is one read-only eBay
  // call); one seller's failure never stops the others.
  const rows = connections ?? [];
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      results.push(await snapshotOne(supabase, row, today));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker()));
  return NextResponse.json({ date: today, results });
}
