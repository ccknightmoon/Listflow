import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { kickWorkerAfterResponse, queueAvailable, QUEUE_UNAVAILABLE, UUID_RE } from "@/lib/jobs/server";
import { serviceDb } from "@/lib/jobs/supabase-store";

export const runtime = "nodejs";

// { action: "retry", jobId }    -- a "Needs a look" job gets 3 fresh attempts
// { action: "cancel", batchId } -- stop everything not yet started in a batch
// Writes use the service role but are always scoped to the signed-in seller.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  if (!(await queueAvailable())) return NextResponse.json(QUEUE_UNAVAILABLE);
  const userId = auth.user.id;
  let body: { action?: unknown; jobId?: unknown; batchId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const db = serviceDb();
  const now = new Date().toISOString();

  if (body.action === "retry" && typeof body.jobId === "string" && UUID_RE.test(body.jobId)) {
    const { data, error } = await db
      .from("listing_jobs")
      .update({ status: "queued", attempts: 0, error: null, run_after: now, updated_at: now, finished_at: null })
      .eq("id", body.jobId)
      .eq("user_id", userId)
      .in("status", ["dead", "canceled"])
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (data?.length) kickWorkerAfterResponse(req.nextUrl.origin);
    return NextResponse.json({ ok: (data?.length ?? 0) > 0 });
  }
  if (body.action === "cancel" && typeof body.batchId === "string" && UUID_RE.test(body.batchId)) {
    const { data, error } = await db
      .from("listing_jobs")
      .update({ status: "canceled", updated_at: now, finished_at: now })
      .eq("batch_id", body.batchId)
      .eq("user_id", userId)
      .eq("status", "queued")
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, canceled: data?.length ?? 0 });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
