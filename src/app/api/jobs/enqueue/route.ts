import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { planGate } from "@/lib/billing/entitlements";
import { MAX_ANALYSIS_PHOTOS } from "@/lib/photo-plan";
import type { NewJob } from "@/lib/jobs/types";
import { isUsersPhotoUrl, jobStore, kickWorkerAfterResponse, queueAvailable, QUEUE_UNAVAILABLE, UUID_RE } from "@/lib/jobs/server";

export const runtime = "nodejs";

const MAX_ITEMS = 300;
const MAX_BATCH_PHOTOS = 600;

// Hands work to the background queue. Two shapes:
//   { batchId, items: [{ key, photoUrls }] }  -- grouping already done on the phone
//   { batchId, group: { photoUrls } }         -- the server groups (AI), then analyzes
// Re-sending the same batchId + key never makes a second job.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const gated = await planGate(auth.user.id, "bulk");
  if (gated) return gated;
  if (!(await queueAvailable())) return NextResponse.json(QUEUE_UNAVAILABLE);
  const userId = auth.user.id;

  let body: { batchId?: unknown; items?: unknown; group?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const batchId = typeof body.batchId === "string" && UUID_RE.test(body.batchId) ? body.batchId : null;
  if (!batchId) return NextResponse.json({ error: "batchId must be a UUID." }, { status: 400 });

  const jobs: NewJob[] = [];
  if (Array.isArray(body.items)) {
    if (body.items.length === 0 || body.items.length > MAX_ITEMS) {
      return NextResponse.json({ error: `Send 1–${MAX_ITEMS} items.` }, { status: 400 });
    }
    for (const it of body.items as { key?: unknown; photoUrls?: unknown }[]) {
      const key = typeof it?.key === "string" || typeof it?.key === "number" ? String(it.key).slice(0, 64) : "";
      const urls = Array.isArray(it?.photoUrls) ? it.photoUrls.filter((u) => isUsersPhotoUrl(u, userId)).slice(0, MAX_ANALYSIS_PHOTOS) : [];
      if (!key || urls.length === 0) return NextResponse.json({ error: "Each item needs a key and at least one uploaded photo." }, { status: 400 });
      jobs.push({ user_id: userId, batch_id: batchId, item_key: key, kind: "analyze", input: { photoUrls: urls } });
    }
  } else if (body.group && typeof body.group === "object") {
    const raw = (body.group as { photoUrls?: unknown }).photoUrls;
    const urls = Array.isArray(raw) ? raw.filter((u) => isUsersPhotoUrl(u, userId)) : [];
    if (urls.length === 0 || urls.length > MAX_BATCH_PHOTOS) {
      return NextResponse.json({ error: `Send 1–${MAX_BATCH_PHOTOS} uploaded photos.` }, { status: 400 });
    }
    jobs.push({ user_id: userId, batch_id: batchId, item_key: "batch", kind: "group", input: { photoUrls: urls } });
  } else {
    return NextResponse.json({ error: "Send items or group." }, { status: 400 });
  }

  try {
    const { inserted } = await jobStore().enqueue(jobs);
    kickWorkerAfterResponse(req.nextUrl.origin);
    return NextResponse.json({ available: true, batchId, inserted, sent: jobs.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
