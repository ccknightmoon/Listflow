"use client";
// Browser side of the background queue: tiny fetch helpers + the shared
// "is a batch running" poller used by the tray pill and /batches.
import type { BatchProgress } from "./types";

export interface JobsListResponse {
  available: boolean;
  message?: string;
  batches: BatchProgress[];
}

export async function fetchBatches(batchId?: string): Promise<JobsListResponse & { jobs?: JobRow[] }> {
  const res = await fetch(batchId ? `/api/jobs?batchId=${batchId}` : "/api/jobs", { cache: "no-store" });
  if (!res.ok) return { available: false, batches: [] };
  return res.json();
}

export interface JobRow {
  id: string;
  batch_id: string;
  item_key: string;
  kind: "group" | "analyze" | "publish";
  status: "queued" | "running" | "done" | "dead" | "canceled";
  attempts: number;
  max_attempts: number;
  result: { title?: string; thumbnail?: string; price?: number; ready?: boolean; reasons?: string[]; url?: string | null; items?: number } | null;
  draft_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

export const kickJobs = () => post("/api/jobs/kick", {}).catch(() => null);
export const enqueueItems = (batchId: string, items: { key: string; photoUrls: string[] }[]) => post("/api/jobs/enqueue", { batchId, items });
export const enqueueGroup = (batchId: string, photoUrls: string[]) => post("/api/jobs/enqueue", { batchId, group: { photoUrls } });
export const publishReady = (batchId: string, draftIds?: string[]) => post("/api/jobs/publish-ready", { batchId, ...(draftIds ? { draftIds } : {}) });
export const retryJob = (jobId: string) => post("/api/jobs/action", { action: "retry", jobId });
export const cancelBatch = (batchId: string) => post("/api/jobs/action", { action: "cancel", batchId });

/** Shows a system notification if the seller allowed it (best-effort). */
export function notifyDone(body: string) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Listflow", { body, icon: "/icon-192.png" });
  } catch {
    // Some browsers (iOS outside an installed app) don't allow page notifications.
  }
}
