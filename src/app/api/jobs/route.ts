import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { queueAvailable, QUEUE_UNAVAILABLE, UUID_RE } from "@/lib/jobs/server";
import { summarizeBatches, type JobRowLite } from "@/lib/jobs/summary";

export const runtime = "nodejs";

// Progress for the tray and /batches. Reads with the seller's own client,
// so RLS limits it to their own jobs.
//   GET /api/jobs            -> recent batches (last 7 days) with progress
//   GET /api/jobs?batchId=…  -> every job in that batch
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  if (!(await queueAvailable())) return NextResponse.json({ ...QUEUE_UNAVAILABLE, batches: [] });

  const batchId = req.nextUrl.searchParams.get("batchId");
  if (batchId) {
    if (!UUID_RE.test(batchId)) return NextResponse.json({ error: "Invalid batchId" }, { status: 400 });
    const { data, error } = await auth.supabase
      .from("listing_jobs")
      .select("id, batch_id, item_key, kind, status, attempts, max_attempts, result, draft_id, error, created_at, updated_at, finished_at")
      .eq("batch_id", batchId)
      .order("item_key")
      .limit(2000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ available: true, jobs: data ?? [], batches: summarizeBatches((data ?? []) as JobRowLite[]) });
  }

  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data, error } = await auth.supabase
    .from("listing_jobs")
    .select("batch_id, kind, status, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ available: true, batches: summarizeBatches((data ?? []) as JobRowLite[]) });
}
