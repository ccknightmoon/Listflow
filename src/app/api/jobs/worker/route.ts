import { NextRequest, NextResponse } from "next/server";
import { runWorker } from "@/lib/jobs/worker";
import { makeProcessors, productionDeps } from "@/lib/jobs/processors";
import { isWorkerAuthorized, triggerWorker } from "@/lib/jobs/trigger";
import { jobStore, queueAvailable, QUEUE_UNAVAILABLE } from "@/lib/jobs/server";
import { serviceDb } from "@/lib/jobs/supabase-store";

export const runtime = "nodejs";
// Vercel Hobby's limit. The worker wraps up after ~45 s (INVOCATION_BUDGET_MS)
// and, if work remains, starts a fresh invocation of itself.
export const maxDuration = 60;

// Background queue worker (Volume Phase 3). Not called by the browser:
// started by /api/jobs/enqueue, /api/jobs/kick, by itself (self-chaining),
// optionally by QStash or a Vercel cron. Requires the worker secret.
async function handle(req: NextRequest) {
  if (!isWorkerAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (!(await queueAvailable())) return NextResponse.json(QUEUE_UNAVAILABLE);

  const store = jobStore();
  const report = await runWorker({ store, processors: makeProcessors(productionDeps(serviceDb(), store)) });
  console.log(JSON.stringify({ event: "jobs_worker", processed: report.processed, chain: report.shouldChain, results: report.results }));
  if (report.shouldChain) await triggerWorker(req.nextUrl.origin);
  return NextResponse.json({ available: true, processed: report.processed, chained: report.shouldChain });
}

export const POST = handle;
// Vercel Cron calls GET with `Authorization: Bearer $CRON_SECRET`.
export const GET = handle;
