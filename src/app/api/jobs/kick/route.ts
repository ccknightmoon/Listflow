import { NextRequest, NextResponse, after } from "next/server";
import { requireUser } from "@/lib/auth";
import { kickWorkerAfterResponse, queueAvailable, QUEUE_UNAVAILABLE } from "@/lib/jobs/server";
import { runPhotoCleanupForUser } from "@/lib/photo-cleanup-server";

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
  // eBay sync used to run here; it's now the app-wide EbaySyncAgent
  // (POST /api/ebay/sync every ~5 min while the app is open), so the two
  // never race over the same window.
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
