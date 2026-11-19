// Server-side background job queue (Volume Phase 3, migration 029).
// Shared types; no runtime imports so the browser can use them too.

export type JobKind = "group" | "analyze" | "publish";
export type JobStatus = "queued" | "running" | "done" | "dead" | "canceled";

export interface Job {
  id: string;
  user_id: string;
  batch_id: string;
  item_key: string;
  kind: JobKind;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_until: string | null;
  lease_token: string | null;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  draft_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface NewJob {
  user_id: string;
  batch_id: string;
  item_key: string;
  kind: JobKind;
  input: Record<string, unknown>;
  max_attempts?: number;
}

/** What a processor tells the worker to do with the job. */
export type Outcome =
  | { type: "done"; result?: Record<string, unknown>; draftId?: string | null }
  /** Made progress but not finished (e.g. grouping chunks): run again soon, attempts reset. */
  | { type: "continue"; result: Record<string, unknown> }
  /** Something failed that may work next time. */
  | { type: "retry"; error: string; rateLimited?: boolean }
  /** Won't work by retrying (cap reached, eBay not connected, invalid draft): straight to Needs a look. */
  | { type: "dead"; error: string; result?: Record<string, unknown> };

export interface ClaimOptions {
  kinds: JobKind[];
  limit: number;
  perUserLimit: number;
  leaseSeconds: number;
}

/** Storage behind the queue. Supabase in production, in-memory in tests. */
export interface JobStore {
  enqueue(jobs: NewJob[]): Promise<{ inserted: number }>;
  claim(opts: ClaimOptions): Promise<Job[]>;
  /** Saves partial results while still holding the lease. False if the lease was lost. */
  checkpoint(job: Job, result: Record<string, unknown>): Promise<boolean>;
  /** Final/next state, only if `job.lease_token` is still the current lease. */
  settle(job: Job, patch: Partial<Pick<Job, "status" | "result" | "draft_id" | "error" | "run_after" | "attempts">>): Promise<boolean>;
  /** Jobs that are due now or within `withinMs` (queued, or running with an expired lease). */
  pendingCount(withinMs: number): Promise<{ due: number; soonest: number | null }>;
}

/** Progress summary for one batch, as shown in the tray and /batches. */
export interface BatchProgress {
  batchId: string;
  createdAt: string;
  total: number;
  byKind: Record<JobKind, { total: number; done: number; dead: number; active: number }>;
}
