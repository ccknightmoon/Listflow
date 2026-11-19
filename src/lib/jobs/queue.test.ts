import { describe, expect, it, vi } from "vitest";
import { MemoryJobStore } from "./memory-store";
import { applyOutcome, retryDelayMs, runWorker, type Processor } from "./worker";
import { applyChunk, initialGroupingState, isGroupingDone, nextChunk } from "./grouping-state";
import { progressLine, summarizeBatches } from "./summary";
import type { JobKind, NewJob } from "./types";

const B = "11111111-1111-4111-8111-111111111111";
const job = (user: string, key: string, kind: JobKind = "analyze"): NewJob => ({ user_id: user, batch_id: B, item_key: key, kind, input: {} });
const claimOpts = { kinds: ["analyze", "group"] as JobKind[], limit: 10, perUserLimit: 6, leaseSeconds: 90 };

describe("claim + lease", () => {
  it("enqueue is idempotent per (user, batch, item, kind)", async () => {
    const s = new MemoryJobStore();
    expect((await s.enqueue([job("u", "1"), job("u", "1"), job("u", "1", "publish")])).inserted).toBe(2);
    expect((await s.enqueue([job("u", "1")])).inserted).toBe(0);
  });

  it("a claimed job can't be claimed again while its lease is live", async () => {
    let t = 1_000_000;
    const s = new MemoryJobStore(() => t);
    await s.enqueue([job("u", "1")]);
    const [a] = await s.claim(claimOpts);
    expect(a.attempts).toBe(1);
    expect(await s.claim(claimOpts)).toHaveLength(0);
    t += 91_000; // worker died; lease expired
    const [b] = await s.claim(claimOpts);
    expect(b.id).toBe(a.id);
    expect(b.attempts).toBe(2);
    // The dead worker's late write is refused.
    expect(await s.settle(a, { status: "done" })).toBe(false);
    expect(await s.settle(b, { status: "done" })).toBe(true);
  });

  it("dead-letters a job whose lease expired after its last attempt", async () => {
    let t = 0;
    const s = new MemoryJobStore(() => t);
    await s.enqueue([{ ...job("u", "1"), max_attempts: 2 }]);
    await s.claim(claimOpts);
    t += 91_000;
    await s.claim(claimOpts);
    t += 91_000;
    expect(await s.claim(claimOpts)).toHaveLength(0);
    expect(s.jobs[0].status).toBe("dead");
    expect(s.jobs[0].error).toMatch(/Stopped responding 2 times/);
  });

  it("caps running jobs per user and shares capacity fairly", async () => {
    const s = new MemoryJobStore();
    await s.enqueue([...Array.from({ length: 8 }, (_, i) => job("a", `a${i}`)), job("b", "b0"), job("b", "b1")]);
    const got = await s.claim({ ...claimOpts, limit: 10, perUserLimit: 3 });
    const per = got.reduce<Record<string, number>>((m, j) => ({ ...m, [j.user_id]: (m[j.user_id] ?? 0) + 1 }), {});
    expect(per).toEqual({ a: 3, b: 2 });
    expect(await s.claim({ ...claimOpts, perUserLimit: 3 })).toHaveLength(0);
  });

  it("respects run_after (backoff) and kinds", async () => {
    let t = 0;
    const s = new MemoryJobStore(() => t);
    await s.enqueue([job("u", "p", "publish")]);
    expect(await s.claim(claimOpts)).toHaveLength(0);
    const [p] = await s.claim({ ...claimOpts, kinds: ["publish"] });
    await applyOutcome(s, p, { type: "retry", error: "eBay 500" }, t);
    expect(await s.claim({ ...claimOpts, kinds: ["publish"] })).toHaveLength(0);
    t += retryDelayMs(1, false) + 1;
    expect(await s.claim({ ...claimOpts, kinds: ["publish"] })).toHaveLength(1);
  });
});

describe("outcomes", () => {
  it("retry → queued with backoff; after max attempts → dead (Needs a look)", async () => {
    const s = new MemoryJobStore(() => 0);
    await s.enqueue([job("u", "1")]);
    let [j] = await s.claim(claimOpts);
    expect(await applyOutcome(s, j, { type: "retry", error: "x", rateLimited: true }, 0)).toBe("queued");
    expect(Date.parse(s.jobs[0].run_after)).toBe(30_000);
    s.jobs[0].run_after = new Date(0).toISOString();
    [j] = await s.claim(claimOpts);
    await applyOutcome(s, j, { type: "retry", error: "x" }, 0);
    s.jobs[0].run_after = new Date(0).toISOString();
    [j] = await s.claim(claimOpts);
    expect(j.attempts).toBe(3);
    expect(await applyOutcome(s, j, { type: "retry", error: "still broken" }, 0)).toBe("dead");
    expect(s.jobs[0]).toMatchObject({ status: "dead", error: "still broken" });
  });

  it("continue resets attempts (progress isn't failure)", async () => {
    const s = new MemoryJobStore(() => 0);
    await s.enqueue([job("u", "g", "group")]);
    const [j] = await s.claim(claimOpts);
    await applyOutcome(s, j, { type: "continue", result: { grouping: { cursor: 15 } } }, 0);
    expect(s.jobs[0]).toMatchObject({ status: "queued", attempts: 0, result: { grouping: { cursor: 15 } } });
  });
});

describe("runWorker (self-chaining)", () => {
  const fastDeps = (s: MemoryJobStore, processors: Partial<Record<JobKind, Processor>>, clock: { t: number }) => ({
    store: s,
    processors: { analyze: async () => ({ type: "done" as const }), group: async () => ({ type: "done" as const }), publish: async () => ({ type: "done" as const }), ...processors },
    now: () => clock.t,
    sleep: async (ms: number) => {
      clock.t += ms;
    },
  });

  it("processes 6 at a time, stops before the time budget and asks to chain while work remains", async () => {
    const clock = { t: 0 };
    const s = new MemoryJobStore(() => clock.t);
    await s.enqueue(Array.from({ length: 20 }, (_, i) => job("u", `i${i}`)));
    let inFlight = 0;
    let peak = 0;
    const analyze: Processor = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      clock.t += 15_000; // one round of analysis takes a while
      inFlight--;
      return { type: "done" };
    };
    const r = await runWorker(fastDeps(s, { analyze }, clock));
    expect(peak).toBe(6);
    expect(r.processed).toBeLessThan(20);
    expect(r.shouldChain).toBe(true);
    // Next invocations finish the rest, then the chain stops.
    let guard = 0;
    let last = r;
    while (last.shouldChain && guard++ < 20) last = await runWorker(fastDeps(s, { analyze }, clock));
    expect(s.jobs.every((j) => j.status === "done")).toBe(true);
    expect(last.shouldChain).toBe(false);
  });

  it("an idle invocation doesn't chain (chains die out)", async () => {
    const clock = { t: 0 };
    const s = new MemoryJobStore(() => clock.t);
    const r = await runWorker(fastDeps(s, {}, clock));
    expect(r).toMatchObject({ processed: 0, shouldChain: false });
  });

  it("waits for a retry that becomes due soon instead of dropping it", async () => {
    const clock = { t: 0 };
    const s = new MemoryJobStore(() => clock.t);
    await s.enqueue([job("u", "1")]);
    let calls = 0;
    const analyze: Processor = async () => (++calls === 1 ? { type: "retry", error: "blip" } : { type: "done" });
    const r = await runWorker(fastDeps(s, { analyze }, clock));
    expect(calls).toBe(2);
    expect(s.jobs[0].status).toBe("done");
    expect(r.processed).toBe(2);
  });

  it("a thrown error becomes a retry, never a crash", async () => {
    const clock = { t: 0 };
    const s = new MemoryJobStore(() => clock.t);
    await s.enqueue([job("u", "1")]);
    const analyze = vi.fn(async () => {
      throw Object.assign(new Error("429"), { isRateLimit: true });
    });
    await runWorker({ ...fastDeps(s, { analyze }, clock), budgetMs: 26_000 });
    expect(s.jobs[0].status).toBe("queued");
    expect(s.jobs[0].error).toBe("429");
  });
});

describe("resumable grouping", () => {
  it("chunks with carry-over and finishes with every photo in one group", () => {
    const total = 40;
    let s = initialGroupingState();
    let calls = 0;
    while (!isGroupingDone(s, total)) {
      const chunk = nextChunk(s, total);
      expect(chunk.length).toBeLessThanOrEqual(15);
      // Fake AI: an item every 4 photos (by global index).
      const groups: number[][] = [];
      chunk.forEach((g, local) => {
        if (local === 0 || g % 4 === 0) groups.push([local]);
        else groups[groups.length - 1].push(local);
      });
      s = applyChunk(s, chunk, { groups }, total);
      calls++;
    }
    expect(calls).toBeGreaterThan(2);
    expect(s.groups.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: total }, (_, i) => i));
    expect(s.groups).toHaveLength(10);
  });
});

describe("progress summary", () => {
  it("shows Analyzing n/total, then a result line", () => {
    const rows = [
      ...Array.from({ length: 50 }, (_, i) => ({ batch_id: B, kind: "analyze" as const, status: (i < 23 ? "done" : "queued") as "done" | "queued", created_at: "2026-11-18T10:00:00Z" })),
    ];
    const [b] = summarizeBatches(rows);
    expect(progressLine(b)).toBe("Analyzing 23/50…");
    const finished = summarizeBatches(rows.map((r, i) => ({ ...r, status: i === 0 ? "dead" : "done" })))[0];
    expect(progressLine(finished)).toBe("49 drafts ready · 1 needs a look");
  });
});
