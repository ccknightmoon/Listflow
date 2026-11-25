import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-service";
import { ebayConnectionForUser } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { runSyncPass } from "@/lib/ebay-auto-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

// Sync every connected seller with eBay (read-only GetSellerEvents + GetItem
// for edited listings), so sold / ended / eBay-app items update even when
// nobody has the app open. Needs CRON_SECRET.
//
// Vercel Hobby crons only run once a day, so this is NOT in vercel.json.
// Schedule it every ~10 minutes with any free scheduler that can send
// `Authorization: Bearer $CRON_SECRET` -- e.g. the GitHub Actions workflow
// in .github/workflows/ebay-sync.yml (off until the repo variable
// EBAY_SYNC_ENABLED=true is set), cron-job.org, or Vercel Pro crons.
const CONCURRENCY = 4;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected || req.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const db = getServiceClient();
  const { data: rows, error } = await db.from("ebay_connections").select("user_id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const users = (rows ?? []).map((r) => r.user_id as string);
  const results: Array<{ userId: string; changed?: boolean; skipped?: string; error?: string }> = [];
  let cursor = 0;
  async function worker() {
    while (cursor < users.length) {
      const userId = users[cursor++];
      try {
        const conn = await ebayConnectionForUser(db, userId);
        if (!conn) { results.push({ userId, skipped: "not connected" }); continue; }
        const r = await ebayContext.run(conn, () => runSyncPass(db, userId, { editLimit: 15 }));
        results.push({ userId, changed: r.summary?.changed ?? false, skipped: r.skipped });
      } catch (e) {
        results.push({ userId, error: (e as Error).message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, users.length) }, () => worker()));
  return NextResponse.json({ sellers: users.length, results });
}
