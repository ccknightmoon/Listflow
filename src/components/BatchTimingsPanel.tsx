"use client";

import { useState } from "react";
import { fmtMs, formatReport, recordSpan, summarize, type BatchTimings } from "@/lib/batch-timings";

export interface PublishSpan {
  start: number;
  end: number;
}

/** Copy of the timings with finished publishes from the queue folded in. */
export function withPublishSpans(t: BatchTimings, spans: PublishSpan[]): BatchTimings {
  const copy: BatchTimings = {
    ...t,
    items: [...t.items],
    stages: Object.fromEntries(Object.entries(t.stages).map(([k, v]) => [k, { ...v }])) as BatchTimings["stages"],
  };
  copy.stages.publish = { firstStart: null, lastEnd: null, busyMs: 0, count: 0 };
  for (const s of spans) recordSpan(copy, "publish", s.start, s.end);
  return copy;
}

/**
 * "How long did this batch take?" -- measured per stage, so the first real
 * batch gives numbers instead of estimates. Collapsed by default.
 */
export default function BatchTimingsPanel({
  timings,
  publishSpans = [],
  upload,
}: {
  timings: BatchTimings;
  publishSpans?: PublishSpan[];
  upload?: { done: number; failed: number; total: number };
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const t = withPublishSpans(timings, publishSpans);
  const sum = summarize(t);
  if (sum.rows.length === 0) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(formatReport(t));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the numbers are still on screen.
    }
  }

  return (
    <div className="card p-3 mb-4 text-xs" data-testid="batch-timings">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="font-semibold text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Batch timings · {fmtMs(sum.totalMs)} so far {open ? "▴" : "▾"}
        </button>
        <button type="button" className="underline" onClick={copy}>
          {copied ? "Copied" : "Copy timings"}
        </button>
      </div>
      {upload && upload.total > 0 && (
        <p className="mt-1" style={{ color: "var(--text-secondary)" }}>
          Photos uploaded in background: {upload.done} of {upload.total}
          {upload.failed > 0 ? ` (${upload.failed} will retry when saved)` : ""}
        </p>
      )}
      {open && (
        <table className="w-full mt-2">
          <thead>
            <tr style={{ color: "var(--text-secondary)" }}>
              <th className="text-left font-normal">Stage</th>
              <th className="text-right font-normal">Wall time</th>
              <th className="text-right font-normal">Done</th>
              <th className="text-right font-normal">Avg each</th>
            </tr>
          </thead>
          <tbody>
            {sum.rows.map((r) => (
              <tr key={r.stage}>
                <td>{r.label}</td>
                <td className="text-right">{fmtMs(r.wallMs)}</td>
                <td className="text-right">{r.count}</td>
                <td className="text-right">{fmtMs(r.avgMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && sum.server.items > 0 && (
        <p className="mt-2" style={{ color: "var(--text-secondary)" }}>
          Per item on the server: vision {fmtMs(sum.server.avgVisionMs)} avg (slowest 10%: {fmtMs(sum.server.p90VisionMs)}), tag
          finder {fmtMs(sum.server.avgTagFinderMs)}, {sum.server.avgPhotos ?? "–"} photos ({sum.server.avgHighDetail ?? "–"} full detail).
          {sum.retries > 0 ? ` ${sum.retries} retr${sum.retries === 1 ? "y" : "ies"} after OpenAI rate limits.` : ""}
        </p>
      )}
    </div>
  );
}
