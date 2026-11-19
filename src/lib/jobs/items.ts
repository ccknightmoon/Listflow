// /batches page helpers (browser-safe, pure).
import type { JobRow } from "./client";

/** One row per item: its analyze job plus (if any) its publish job. */
export function itemsFromJobs(jobs: JobRow[]) {
  const publishByDraft = new Map(jobs.filter((j) => j.kind === "publish").map((j) => [j.item_key, j]));
  return jobs
    .filter((j) => j.kind === "analyze")
    .map((a) => ({ analyze: a, publish: a.draft_id ? publishByDraft.get(a.draft_id) ?? null : null }));
}

export function statusOf(it: { analyze: JobRow; publish: JobRow | null }): { label: string; tone: "busy" | "ok" | "warn" | "bad" | "muted" } {
  const { analyze: a, publish: p } = it;
  if (p?.status === "done") return { label: "Listed", tone: "ok" };
  if (p?.status === "dead") return { label: "Listing failed — needs a look", tone: "bad" };
  if (p && (p.status === "queued" || p.status === "running")) return { label: "Listing on eBay…", tone: "busy" };
  if (a.status === "queued") return { label: a.attempts > 0 ? "Retrying soon…" : "Waiting…", tone: "muted" };
  if (a.status === "running") return { label: "Analyzing…", tone: "busy" };
  if (a.status === "dead") return { label: "Needs a look", tone: "bad" };
  if (a.status === "canceled") return { label: "Canceled", tone: "muted" };
  return a.result?.ready ? { label: "Ready", tone: "ok" } : { label: "Draft · check it", tone: "warn" };
}

