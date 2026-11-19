import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { kickWorkerAfterResponse, queueAvailable, QUEUE_UNAVAILABLE } from "@/lib/jobs/server";

export const runtime = "nodejs";

// The sweep: called when the app opens (and while a batch is active). If
// this seller has work that is due or stalled (a worker died, a chain was
// dropped), start the worker again. Vercel Hobby crons only run daily, so
// this is what keeps a batch moving without a paid plan.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
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
