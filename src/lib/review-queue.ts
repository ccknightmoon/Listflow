// Swipe-to-approve review queue (browser-safe, pure). Works on the server
// queue's items (/batches): one card per finished draft, flagged fields
// only, approve / hold back, then "List all Ready".
//
// What gets listed: every item Sel approved, plus every item the server
// already marked Ready that Sel didn't hold back. Items never reviewed keep
// the server's verdict, so "List all Ready" works with or without a review.
import type { JobRow } from "./jobs/client";

export type Decision = "approve" | "hold";
export type Decisions = Record<string, Decision>;

export interface ReviewItem {
  draftId: string;
  title: string;
  thumbnail: string | null;
  price: number | null;
  /** Best Offer floor saved with the draft (null = no offers). */
  floor?: number | null;
  /** Server's verdict when the draft was made. */
  ready: boolean;
  /** The flagged fields (blocking reasons), in plain English. */
  reasons: string[];
}

/** Finished, not-yet-listed drafts from a batch's jobs, in item order. */
export function reviewItemsFromJobs(jobs: JobRow[]): ReviewItem[] {
  const published = new Set(jobs.filter((j) => j.kind === "publish" && j.status !== "canceled").map((j) => j.item_key));
  return jobs
    .filter((j) => j.kind === "analyze" && j.status === "done" && j.draft_id && !published.has(j.draft_id))
    .sort((a, b) => a.item_key.localeCompare(b.item_key))
    .map((j) => ({
      draftId: j.draft_id as string,
      title: j.result?.title || `Item ${j.item_key}`,
      thumbnail: j.result?.thumbnail ?? null,
      price: typeof j.result?.price === "number" ? j.result.price : null,
      floor: typeof (j.result as { floor?: unknown } | null | undefined)?.floor === "number" ? ((j.result as { floor: number }).floor) : null,
      ready: !!j.result?.ready,
      reasons: j.result?.reasons ?? [],
    }));
}

export function willList(item: ReviewItem, decisions: Decisions): boolean {
  const d = decisions[item.draftId];
  if (d === "approve") return true;
  if (d === "hold") return false;
  return item.ready;
}

export function draftIdsToList(items: ReviewItem[], decisions: Decisions): string[] {
  return items.filter((it) => willList(it, decisions)).map((it) => it.draftId);
}

/** First item at or after `from` that hasn't been decided yet (else -1). */
export function nextUndecided(items: ReviewItem[], decisions: Decisions, from = 0): number {
  for (let i = Math.max(0, from); i < items.length; i++) if (!decisions[items[i].draftId]) return i;
  return -1;
}

/** Horizontal drag -> decision, once it's clearly sideways and far enough. */
export function swipeDecision(dx: number, dy: number, width: number): Decision | null {
  const threshold = Math.max(80, width * 0.25);
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx > 0 ? "approve" : "hold";
}

/** "Set a price" etc. -> does this card need the inline price field? */
export function needsPrice(item: ReviewItem): boolean {
  return item.price == null || item.price <= 0 || item.reasons.some((r) => /price/i.test(r));
}

export function parsePriceInput(raw: string): number | null {
  const n = Number(raw.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 100_000) return null;
  return Math.round(n * 100) / 100;
}

// Decisions survive a reload on this device (per batch). Best-effort only.
const KEY = (batchId: string) => `listflow:review:${batchId}`;

export function loadDecisions(batchId: string): Decisions {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY(batchId)) : null;
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Decisions = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (v === "approve" || v === "hold") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function saveDecisions(batchId: string, d: Decisions): void {
  try {
    localStorage.setItem(KEY(batchId), JSON.stringify(d));
  } catch {
    // private mode / storage full: decisions just won't survive a reload
  }
}
