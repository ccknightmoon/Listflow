// JobStore on Supabase (migration 029), using the service-role key. Server only.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ClaimOptions, Job, JobStore, NewJob } from "./types";

export function serviceDb(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

/** True when the error means migration 029 isn't applied. */
export function isQueueMissing(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    err.code === "PGRST202" ||
    err.code === "42883" ||
    /listing_jobs|claim_listing_jobs|could not find the (table|function)|does not exist/i.test(err.message ?? "")
  );
}

export class SupabaseJobStore implements JobStore {
  constructor(private db: SupabaseClient = serviceDb()) {}

  async enqueue(jobs: NewJob[]) {
    if (jobs.length === 0) return { inserted: 0 };
    const rows = jobs.map((j) => ({ ...j, max_attempts: j.max_attempts ?? 3 }));
    const { data, error } = await this.db
      .from("listing_jobs")
      .upsert(rows, { onConflict: "user_id,batch_id,item_key,kind", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    return { inserted: data?.length ?? 0 };
  }

  async claim(o: ClaimOptions) {
    const { data, error } = await this.db.rpc("claim_listing_jobs", {
      p_kinds: o.kinds,
      p_limit: o.limit,
      p_per_user_limit: o.perUserLimit,
      p_lease_seconds: o.leaseSeconds,
    });
    if (error) throw error;
    return (data ?? []) as Job[];
  }

  async checkpoint(job: Job, result: Record<string, unknown>) {
    const { data, error } = await this.db
      .from("listing_jobs")
      .update({ result, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "running")
      .eq("lease_token", job.lease_token!)
      .select("id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  async settle(job: Job, patch: Parameters<JobStore["settle"]>[1]) {
    const now = new Date().toISOString();
    const finished = patch.status === "done" || patch.status === "dead";
    const row: Record<string, unknown> = { ...patch, updated_at: now };
    if (patch.status && patch.status !== "running") {
      row.lease_token = null;
      row.locked_until = null;
    }
    if (finished) row.finished_at = now;
    const { data, error } = await this.db
      .from("listing_jobs")
      .update(row)
      .eq("id", job.id)
      .eq("status", "running")
      .eq("lease_token", job.lease_token!)
      .select("id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  async pendingCount(withinMs: number) {
    const horizon = new Date(Date.now() + withinMs).toISOString();
    const [queued, stalled] = await Promise.all([
      this.db.from("listing_jobs").select("run_after").eq("status", "queued").lte("run_after", horizon).order("run_after").limit(1000),
      this.db.from("listing_jobs").select("locked_until").eq("status", "running").lte("locked_until", horizon).order("locked_until").limit(1000),
    ]);
    if (queued.error) throw queued.error;
    if (stalled.error) throw stalled.error;
    const times = [
      ...(queued.data ?? []).map((r) => Date.parse(r.run_after as string)),
      ...(stalled.data ?? []).map((r) => Date.parse(r.locked_until as string)),
    ];
    return { due: times.length, soonest: times.length ? Math.min(...times) : null };
  }
}
