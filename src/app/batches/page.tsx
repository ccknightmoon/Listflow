"use client";

import { Suspense, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Bell, CheckCircle2, ExternalLink, Loader2, RotateCw, Send, XCircle } from "lucide-react";
import { cancelBatch, fetchBatches, kickJobs, publishReady, retryJob, type JobRow } from "@/lib/jobs/client";
import { isBatchActive, progressLine } from "@/lib/jobs/summary";
import type { BatchProgress } from "@/lib/jobs/types";
import { confirmAction } from "@/lib/confirm";
import { itemsFromJobs, statusOf } from "@/lib/jobs/items";

const TONE: Record<string, string> = { busy: "var(--accent)", ok: "var(--success)", warn: "var(--warning, #b7791f)", bad: "var(--danger)", muted: "var(--text-secondary)" };

function BatchesInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [batches, setBatches] = useState<BatchProgress[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Re-read after the permission prompt (bumped below).
  const [permVersion, setPermVersion] = useState(0);
  const notifyState = useSyncExternalStore(
    () => () => {},
    (): NotificationPermission | "unsupported" => (void permVersion, typeof Notification === "undefined" ? "unsupported" : Notification.permission),
    () => "unsupported" as const
  );
  const selected = params.get("batch") ?? batches[0]?.batchId ?? null;
  const current = batches.find((b) => b.batchId === selected) ?? null;

  const load = useCallback(async () => {
    const list = await fetchBatches();
    setAvailable(list.available);
    setMessage(list.message ?? "");
    setBatches(list.batches);
    const id = params.get("batch") ?? list.batches[0]?.batchId;
    if (id) {
      const detail = await fetchBatches(id);
      setJobs(detail.jobs ?? []);
    }
    return list.batches.some(isBatchActive);
  }, [params]);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const loop = async () => {
      const active = await load().catch(() => false);
      if (!stopped && active) timer = window.setTimeout(loop, 5000);
    };
    void kickJobs().then(loop);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [load]);

  const items = itemsFromJobs(jobs);
  const group = jobs.find((j) => j.kind === "group");
  const readyIds = items
    .filter((it) => it.analyze.status === "done" && it.analyze.result?.ready && it.analyze.draft_id && !it.publish)
    .map((it) => it.analyze.draft_id!) as string[];

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      window.dispatchEvent(new Event("listflow:jobs-started"));
      await load();
      // Restart polling in case the batch was idle.
      window.setTimeout(() => void load(), 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Link href="/batch-upload" className="p-2 -ml-2" aria-label="Back"><ArrowLeft className="w-5 h-5" /></Link>
        <h1 className="text-xl font-bold">Background batches</h1>
      </div>

      {available === false && <div className="card p-4 text-sm">{message || "Background processing isn't switched on yet."}</div>}
      {available === null && <Loader2 className="w-5 h-5 animate-spin" />}

      {available && batches.length === 0 && (
        <div className="card p-4 text-sm">No background batches in the last 7 days. Start one from <Link className="underline" href="/batch-upload">Batch Upload</Link>.</div>
      )}

      {batches.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
          {batches.map((b) => (
            <button
              key={b.batchId}
              type="button"
              role="tab"
              aria-selected={b.batchId === selected}
              onClick={() => router.replace(`/batches?batch=${b.batchId}`)}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs border"
              style={{ borderColor: b.batchId === selected ? "var(--accent)" : "var(--glass-line)" }}
            >
              {new Date(b.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {b.byKind.analyze.total || "…"} items
            </button>
          ))}
        </div>
      )}

      {current && (
        <div className="card p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 font-semibold">
            {isBatchActive(current) ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--accent)" }} /> : <CheckCircle2 className="w-4 h-4" style={{ color: "var(--success)" }} />}
            {progressLine(current)}
          </div>
          {isBatchActive(current) && (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              You can close the app — we&apos;ll keep working. Drafts appear here and in Drafts as they finish.
            </p>
          )}
          {group?.status === "dead" && <p className="text-sm" style={{ color: "var(--danger)" }}>Grouping stopped: {group.error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary text-sm"
              disabled={!readyIds.length || !!busy}
              onClick={async () => {
                if (!(await confirmAction({ title: `List ${readyIds.length} Ready item${readyIds.length === 1 ? "" : "s"} on eBay?`, message: "They'll be published in the background, even if you close the app.", confirmLabel: "List them" }))) return;
                void run("publish", () => publishReady(current.batchId, readyIds));
              }}
            >
              {busy === "publish" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} List all Ready ({readyIds.length})
            </button>
            {notifyState === "default" && (
              <button type="button" className="btn text-sm" onClick={async () => {
                  await Notification.requestPermission();
                  setPermVersion((v) => v + 1);
                }}>
                <Bell className="w-4 h-4" /> Notify me when done
              </button>
            )}
            {isBatchActive(current) && (
              <button
                type="button"
                className="btn text-sm"
                disabled={!!busy}
                onClick={async () => {
                  if (!(await confirmAction({ title: "Stop this batch?", message: "Items not started yet are canceled. Items already being worked on finish.", confirmLabel: "Stop", destructive: true }))) return;
                  void run("cancel", () => cancelBatch(current.batchId));
                }}
              >
                <XCircle className="w-4 h-4" /> Stop
              </button>
            )}
          </div>
          {notifyState === "denied" && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Notifications are blocked for this site in your browser settings.</p>}
          {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {items.map((it) => {
          const s = statusOf(it);
          const a = it.analyze;
          const failed = it.publish?.status === "dead" ? it.publish : a.status === "dead" ? a : null;
          return (
            <li key={a.id} className="card p-3 flex gap-3 items-center">
              {a.result?.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element -- storage URL, already sized
                <img src={a.result.thumbnail} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />
              ) : (
                <div className="w-14 h-14 rounded-lg shrink-0" style={{ background: "var(--glass)" }} />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{a.result?.title || `Item ${a.item_key}`}</p>
                <p className="text-xs" style={{ color: TONE[s.tone] }}>
                  {s.label}
                  {typeof a.result?.price === "number" ? <span style={{ color: "var(--text-secondary)" }}> · ${a.result.price}</span> : null}
                </p>
                {failed?.error && <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{failed.error}</p>}
                {s.tone === "warn" && a.result?.reasons?.length ? <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{a.result.reasons.join(" · ")}</p> : null}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {failed && (
                  <button type="button" className="btn text-xs" disabled={!!busy} onClick={() => void run(`retry-${failed.id}`, () => retryJob(failed.id))} aria-label="Retry">
                    <RotateCw className="w-3.5 h-3.5" /> Retry
                  </button>
                )}
                {it.publish?.result?.url && (
                  <a href={it.publish.result.url} target="_blank" rel="noreferrer" className="btn text-xs" aria-label="View on eBay"><ExternalLink className="w-3.5 h-3.5" /></a>
                )}
                {a.draft_id && <Link href={`/drafts/${a.draft_id}`} className="btn text-xs">Open</Link>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        Notifications: work on desktop browsers and Android. On iPhone they only work if Listflow is added to the Home Screen, and only while it&apos;s open — the batch itself keeps running either way.
      </p>
    </div>
  );
}

export default function BatchesPage() {
  return (
    <Suspense fallback={null}>
      <BatchesInner />
    </Suspense>
  );
}
