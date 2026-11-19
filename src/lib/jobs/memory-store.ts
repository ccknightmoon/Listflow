// In-memory JobStore with the same rules as migration 029's SQL (claim
// with per-user cap, lease expiry, dead-letter, lease-checked writes).
// Used by tests; also documents the intended semantics in plain code.
import type { ClaimOptions, Job, JobStore, NewJob } from "./types";

export class MemoryJobStore implements JobStore {
  jobs: Job[] = [];
  private seq = 0;
  constructor(public now: () => number = () => Date.now()) {}

  private iso(ms: number) {
    return new Date(ms).toISOString();
  }

  async enqueue(news: NewJob[]) {
    let inserted = 0;
    for (const n of news) {
      if (this.jobs.some((j) => j.user_id === n.user_id && j.batch_id === n.batch_id && j.item_key === n.item_key && j.kind === n.kind)) continue;
      const t = this.iso(this.now() + this.seq);
      this.jobs.push({
        id: `job-${++this.seq}`,
        user_id: n.user_id,
        batch_id: n.batch_id,
        item_key: n.item_key,
        kind: n.kind,
        status: "queued",
        attempts: 0,
        max_attempts: n.max_attempts ?? 3,
        run_after: this.iso(this.now()),
        locked_until: null,
        lease_token: null,
        input: n.input,
        result: null,
        draft_id: null,
        error: null,
        created_at: t,
        updated_at: t,
        finished_at: null,
      });
      inserted++;
    }
    return { inserted };
  }

  private expired(j: Job, now: number) {
    return j.status === "running" && !!j.locked_until && Date.parse(j.locked_until) < now;
  }

  async claim(o: ClaimOptions) {
    const now = this.now();
    for (const j of this.jobs) {
      if (o.kinds.includes(j.kind) && this.expired(j, now) && j.attempts >= j.max_attempts) {
        Object.assign(j, { status: "dead", error: j.error ?? `Stopped responding ${j.attempts} times`, lease_token: null, locked_until: null, finished_at: this.iso(now) });
      }
    }
    const running = new Map<string, number>();
    for (const j of this.jobs) {
      if (o.kinds.includes(j.kind) && j.status === "running" && j.locked_until && Date.parse(j.locked_until) >= now) {
        running.set(j.user_id, (running.get(j.user_id) ?? 0) + 1);
      }
    }
    const candidates = this.jobs
      .filter((j) => o.kinds.includes(j.kind) && ((j.status === "queued" && Date.parse(j.run_after) <= now) || this.expired(j, now)))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const rank = new Map<string, number>();
    const picked: Job[] = [];
    const withRank = candidates.map((j) => {
      const r = (rank.get(j.user_id) ?? 0) + 1;
      rank.set(j.user_id, r);
      return { j, r };
    });
    withRank.sort((a, b) => a.r - b.r || a.j.id.localeCompare(b.j.id));
    for (const { j, r } of withRank) {
      if (picked.length >= o.limit) break;
      if (r + (running.get(j.user_id) ?? 0) > o.perUserLimit) continue;
      Object.assign(j, {
        status: "running",
        attempts: j.attempts + 1,
        lease_token: `lease-${++this.seq}`,
        locked_until: this.iso(now + o.leaseSeconds * 1000),
        updated_at: this.iso(now),
      });
      picked.push({ ...j });
    }
    return picked;
  }

  private current(job: Job) {
    const j = this.jobs.find((x) => x.id === job.id);
    return j && j.status === "running" && j.lease_token === job.lease_token ? j : null;
  }

  async checkpoint(job: Job, result: Record<string, unknown>) {
    const j = this.current(job);
    if (!j) return false;
    j.result = result;
    j.updated_at = this.iso(this.now());
    return true;
  }

  async settle(job: Job, patch: Parameters<JobStore["settle"]>[1]) {
    const j = this.current(job);
    if (!j) return false;
    Object.assign(j, patch, { updated_at: this.iso(this.now()) });
    if (j.status !== "running") {
      j.lease_token = null;
      j.locked_until = null;
    }
    if (j.status === "done" || j.status === "dead") j.finished_at = this.iso(this.now());
    return true;
  }

  async pendingCount(withinMs: number) {
    const now = this.now();
    const times = this.jobs
      .filter((j) => j.status === "queued" || j.status === "running")
      .map((j) => (j.status === "queued" ? Date.parse(j.run_after) : Date.parse(j.locked_until ?? j.run_after)))
      .filter((t) => t <= now + withinMs);
    return { due: times.length, soonest: times.length ? Math.min(...times) : null };
  }
}
