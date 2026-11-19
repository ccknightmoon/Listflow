// The queue worker loop, independent of Vercel/Supabase so it can be
// tested with MemoryJobStore. One invocation = claim a few jobs, run them
// in parallel, record each outcome, repeat while there's time, then say
// whether another invocation should follow (self-chaining).
import type { ClaimOptions, Job, JobKind, JobStore, Outcome } from "./types";

export interface ProcessorContext {
  /** Saves partial progress (keeps the lease). */
  checkpoint(result: Record<string, unknown>): Promise<boolean>;
  /** Absolute ms timestamp this invocation should wrap up by. */
  deadline: number;
  now(): number;
}
export type Processor = (job: Job, ctx: ProcessorContext) => Promise<Outcome>;

/** Claim pools: grouping+analysis share OpenAI capacity; publishing is eBay-bound. */
export const POOLS: Omit<ClaimOptions, "leaseSeconds">[] = [
  { kinds: ["group", "analyze"], limit: 6, perUserLimit: 6 },
  { kinds: ["publish"], limit: 4, perUserLimit: 2 },
];
/** Longer than Vercel's 60 s limit, so an expired lease means the worker really died. */
export const LEASE_SECONDS = 90;
/** Don't start a new round with less than this left. */
export const MIN_ROUND_MS = 25_000;
/** Wrap up this long after starting (Vercel Hobby kills functions at 60 s). */
export const INVOCATION_BUDGET_MS = 45_000;

export function retryDelayMs(attempt: number, rateLimited: boolean): number {
  return rateLimited ? 30_000 * attempt : 10_000 * attempt;
}

/** Applies a processor outcome to the job (lease-checked). */
export async function applyOutcome(store: JobStore, job: Job, outcome: Outcome, now: number): Promise<"done" | "queued" | "dead" | "lost"> {
  let patch: Parameters<JobStore["settle"]>[1];
  let label: "done" | "queued" | "dead";
  switch (outcome.type) {
    case "done":
      patch = { status: "done", result: outcome.result ?? job.result, draft_id: outcome.draftId ?? job.draft_id, error: null };
      label = "done";
      break;
    case "continue":
      // Progress was made: not a failure, so attempts start over.
      patch = { status: "queued", result: outcome.result, attempts: 0, run_after: new Date(now).toISOString(), error: null };
      label = "queued";
      break;
    case "retry":
      if (job.attempts >= job.max_attempts) {
        patch = { status: "dead", error: outcome.error };
        label = "dead";
      } else {
        patch = { status: "queued", error: outcome.error, run_after: new Date(now + retryDelayMs(job.attempts, !!outcome.rateLimited)).toISOString() };
        label = "queued";
      }
      break;
    case "dead":
      patch = { status: "dead", error: outcome.error, ...(outcome.result ? { result: outcome.result } : {}) };
      label = "dead";
      break;
  }
  const ok = await store.settle(job, patch);
  return ok ? label : "lost";
}

export interface WorkerDeps {
  store: JobStore;
  processors: Record<JobKind, Processor>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  budgetMs?: number;
  minRoundMs?: number;
  pools?: Omit<ClaimOptions, "leaseSeconds">[];
}

export interface WorkerReport {
  processed: number;
  results: { id: string; kind: JobKind; outcome: string }[];
  shouldChain: boolean;
}

export async function runWorker(deps: WorkerDeps): Promise<WorkerReport> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = now();
  const deadline = start + (deps.budgetMs ?? INVOCATION_BUDGET_MS);
  const minRound = deps.minRoundMs ?? MIN_ROUND_MS;
  const pools = deps.pools ?? POOLS;
  const report: WorkerReport = { processed: 0, results: [], shouldChain: false };
  let waited = false;

  while (deadline - now() >= minRound) {
    const claimed: Job[] = [];
    for (const p of pools) claimed.push(...(await deps.store.claim({ ...p, leaseSeconds: LEASE_SECONDS })));

    if (claimed.length === 0) {
      // Nothing due right now. If something becomes due soon (a retry's
      // backoff), wait for it once instead of ending the chain.
      if (waited) break;
      const room = deadline - now() - minRound;
      const p = await deps.store.pendingCount(Math.max(room, 0));
      if (!p.soonest || room <= 0) break;
      waited = true;
      await sleep(Math.max(p.soonest - now(), 0) + 50);
      continue;
    }

    await Promise.all(
      claimed.map(async (job) => {
        let outcome: Outcome;
        try {
          outcome = await deps.processors[job.kind](job, {
            checkpoint: (r) => deps.store.checkpoint(job, r),
            deadline,
            now,
          });
        } catch (err) {
          outcome = { type: "retry", error: (err as Error)?.message || "Unexpected error", rateLimited: !!(err as { isRateLimit?: boolean })?.isRateLimit };
        }
        const label = await applyOutcome(deps.store, job, outcome, now()).catch(() => "lost" as const);
        report.processed++;
        report.results.push({ id: job.id, kind: job.kind, outcome: label });
      })
    );
  }

  // Chain when this invocation did work and more is (or soon will be) due.
  // An invocation that found nothing ends the chain, so idle chains die out.
  if (report.processed > 0) {
    const p = await deps.store.pendingCount(60_000).catch(() => ({ due: 0, soonest: null }));
    report.shouldChain = p.due > 0;
  }
  return report;
}
