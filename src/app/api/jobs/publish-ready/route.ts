import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import type { NewJob } from "@/lib/jobs/types";
import { jobStore, kickWorkerAfterResponse, queueAvailable, QUEUE_UNAVAILABLE, UUID_RE } from "@/lib/jobs/server";

export const runtime = "nodejs";

// "List all Ready" on the server: one publish job per Ready draft in the
// batch (or per given draft id). Publishing then finishes with the app
// closed. Never lists a draft twice: one publish job per draft per batch,
// and the publish code itself skips drafts that already have a listing.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  if (!(await queueAvailable())) return NextResponse.json(QUEUE_UNAVAILABLE);
  const userId = auth.user.id;

  let body: { batchId?: unknown; draftIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const batchId = typeof body.batchId === "string" && UUID_RE.test(body.batchId) ? body.batchId : null;
  if (!batchId) return NextResponse.json({ error: "batchId must be a UUID." }, { status: 400 });

  let draftIds: string[];
  if (Array.isArray(body.draftIds)) {
    draftIds = body.draftIds.filter((d): d is string => typeof d === "string" && UUID_RE.test(d)).slice(0, 300);
  } else {
    const { data, error } = await auth.supabase
      .from("listing_jobs")
      .select("draft_id, result")
      .eq("batch_id", batchId)
      .eq("kind", "analyze")
      .eq("status", "done")
      .not("draft_id", "is", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    draftIds = (data ?? []).filter((j) => (j.result as { ready?: boolean } | null)?.ready).map((j) => j.draft_id as string);
  }
  if (draftIds.length === 0) return NextResponse.json({ available: true, inserted: 0, sent: 0 });

  // Only this seller's drafts that aren't on eBay yet.
  const { data: drafts, error: dErr } = await auth.supabase
    .from("drafts")
    .select("id, title")
    .in("id", draftIds)
    .eq("user_id", userId)
    .is("ebay_listing_id", null);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  const jobs: NewJob[] = (drafts ?? []).map((d) => ({
    user_id: userId,
    batch_id: batchId,
    item_key: d.id as string,
    kind: "publish",
    input: { draftId: d.id, title: d.title ?? "" },
  }));
  try {
    const { inserted } = await jobStore().enqueue(jobs);
    kickWorkerAfterResponse(req.nextUrl.origin);
    return NextResponse.json({ available: true, inserted, sent: jobs.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
