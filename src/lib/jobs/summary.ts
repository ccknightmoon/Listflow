// Pure progress math for the tray and /batches (browser-safe).
import type { BatchProgress, JobKind, JobStatus } from "./types";

export interface JobRowLite {
  batch_id: string;
  kind: JobKind;
  status: JobStatus;
  created_at: string;
}

const emptyKind = () => ({ total: 0, done: 0, dead: 0, active: 0 });

export function summarizeBatches(rows: JobRowLite[]): BatchProgress[] {
  const map = new Map<string, BatchProgress>();
  for (const r of rows) {
    let b = map.get(r.batch_id);
    if (!b) {
      b = { batchId: r.batch_id, createdAt: r.created_at, total: 0, byKind: { group: emptyKind(), analyze: emptyKind(), publish: emptyKind() } };
      map.set(r.batch_id, b);
    }
    if (r.created_at < b.createdAt) b.createdAt = r.created_at;
    b.total++;
    const k = b.byKind[r.kind];
    k.total++;
    if (r.status === "done") k.done++;
    else if (r.status === "dead") k.dead++;
    else if (r.status === "queued" || r.status === "running") k.active++;
  }
  return [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function isBatchActive(b: BatchProgress): boolean {
  return b.byKind.group.active + b.byKind.analyze.active + b.byKind.publish.active > 0;
}

/** One line for the tray, e.g. "Analyzing 23/50…". */
export function progressLine(b: BatchProgress): string {
  const g = b.byKind.group;
  const a = b.byKind.analyze;
  const p = b.byKind.publish;
  if (g.active > 0) return "Grouping photos into items…";
  if (a.active > 0) return `Analyzing ${a.done + a.dead}/${a.total}…`;
  if (p.active > 0) return `Listing on eBay ${p.done + p.dead}/${p.total}…`;
  const parts = [`${a.done} draft${a.done === 1 ? "" : "s"} ready`];
  if (p.done) parts.push(`${p.done} listed`);
  const dead = a.dead + p.dead + g.dead;
  if (dead) parts.push(`${dead} need${dead === 1 ? "s" : ""} a look`);
  return parts.join(" · ");
}
