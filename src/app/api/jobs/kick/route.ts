import { NextRequest, NextResponse, after } from "next/server";
import { requireUser } from "@/lib/auth";
import { kickWorkerAfterResponse, queueAvailable, QUEUE_UNAVAILABLE } from "@/lib/jobs/server";
import { runPhotoCleanupForUser } from "@/lib/photo-cleanup-server";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { sweepEbayChanges } from "@/lib/ebay-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

// The sweep, called when the app opens (and while a batch is active):
// 1) If this seller has background work that is due or stalled (a worker
//    died, a chain was dropped), start the worker again. Vercel Hobby crons
//    only run daily, so this is what keeps a batch moving for free.
// 2) Once a day, the photo storage cleanup (src/lib/photo-cleanup.ts),
//    after the response so it never slows the app down.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const userId = auth.user.id;
  // Pull edits made in the eBay app into linked drafts (GetSellerEvents;
  // at most every 10 minutes; needs migration 034, else skipped).
  const connection = await requireEbayConnection(auth).catch(() => null);
  if (connection) {
    after(async () => {
      try {
        const r = await ebayContext.run(connection, () => sweepEbayChanges(auth.supabase, userId));
        if (r.updated || r.conflicts) console.log(JSON.stringify({ event: "ebay_sync", userId, ...r }));
      } catch (err) {
        console.error("ebay sync:", (err as Error).message);
      }
    });
  }
  after(async () => {
    try {
      const r = await runPhotoCleanupForUser(userId);
      if (r.draftsCleaned || r.orphansDeleted) console.log(JSON.stringify({ event: "photo_cleanup", userId, ...r }));
    } catch (err) {
      console.error("photo cleanup:", (err as Error).message);
    }
  });

  if (!(await queueAvailable())) return NextResponse.json(QUEUE_UNAVAILABLE);
  const now = new Date().toISOString();
  // RLS: the seller's own jobs only.
  const [due, stalled] = await Promise.all([
    auth.supabase.from("listing_jobs").select("id", { count: "exact", head: true }).eq("status", "queued").lte("run_after", now),
    auth.supabase.from("listing_jobs").select("id", { count: "exact", head: true }).eq("status", "running").lt("locked_until", now),
  ]);
  const needs = (due.count ?? 0) + (stalled.count ?? 0);
  if (needs > 0) kickWorkerAfterResponse(req.nextUrl.origin);
  return NextResponse.json({ available: true, kicked: needs > 0, due: due.count ?? 0, stalled: stalled.count ?? 0 });
}
