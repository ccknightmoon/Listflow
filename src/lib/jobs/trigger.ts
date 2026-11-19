// Starting the worker. Default ("direct", free): POST our own
// /api/jobs/worker with a secret and move on without waiting -- the worker
// runs as its own 60-second Vercel invocation and chains itself while work
// remains. Optional upgrade ("qstash", Upstash free tier): QStash delivers
// the call with its own retries, so a dropped hand-off can't stall a batch.
// Pick with JOBS_TRIGGER=direct|qstash. Server only.
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Secret the worker accepts. JOBS_WORKER_SECRET if set; otherwise derived
 * from the service-role key so no new setting is needed.
 */
export function workerToken(): string {
  const explicit = process.env.JOBS_WORKER_SECRET;
  if (explicit) return explicit;
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return base ? createHmac("sha256", base).update("listflow-jobs-worker-v1").digest("hex") : "";
}

/** Accepts `Authorization: Bearer <workerToken>` or Vercel Cron's CRON_SECRET. */
export function isWorkerAuthorized(authHeader: string | null): boolean {
  const got = (authHeader ?? "").replace(/^Bearer\s+/i, "");
  if (!got) return false;
  const ok = (expected: string | undefined) => {
    if (!expected) return false;
    const a = Buffer.from(got);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  return ok(workerToken()) || ok(process.env.CRON_SECRET);
}

export function workerUrl(origin: string): string {
  return process.env.JOBS_WORKER_URL || `${origin.replace(/\/$/, "")}/api/jobs/worker`;
}

export type TriggerMode = "direct" | "qstash";
export function triggerMode(): TriggerMode {
  return process.env.JOBS_TRIGGER === "qstash" && process.env.QSTASH_TOKEN ? "qstash" : "direct";
}

/**
 * Fire-and-forget start of one worker invocation. Never throws. The direct
 * mode only waits long enough for the request to be sent.
 */
export async function triggerWorker(origin: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const url = workerUrl(origin);
  const token = workerToken();
  if (!token) return false;
  try {
    if (triggerMode() === "qstash") {
      const res = await fetchImpl(`https://qstash.upstash.io/v2/publish/${url}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.QSTASH_TOKEN}`,
          "Upstash-Forward-Authorization": `Bearer ${token}`,
          "Upstash-Retries": "2",
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    }
    await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(2500),
    });
    return true;
  } catch (err) {
    // A timeout here is expected: the worker keeps running on its own.
    return (err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError";
  }
}
