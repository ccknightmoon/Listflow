"use client";

import type { Confidence } from "@/lib/confidence";

// "Ready" (green) or "Needs a look" (amber) with the exact fields to check.
export default function ConfidenceBadge({ confidence, className = "px-4 pt-3" }: { confidence: Confidence; className?: string }) {
  const ready = confidence.status === "ready";
  return (
    <div className={className} role="status">
      <div className="rounded-xl px-3 py-2 text-xs" style={{ background: ready ? "color-mix(in srgb, var(--success) 14%, var(--bg-surface))" : "var(--warning-bg)", border: `1px solid ${ready ? "color-mix(in srgb, var(--success) 40%, transparent)" : "var(--warning-border)"}` }}>
        <p className="font-semibold" style={{ color: ready ? "var(--success)" : "var(--text-primary)" }}>
          {ready ? "Ready to list" : "Needs a look"} · {confidence.score}%
        </p>
        {!ready && confidence.reasons.length > 0 && (
          <ul className="mt-1 list-disc pl-4" style={{ color: "var(--text-secondary)" }}>
            {confidence.reasons.slice(0, 4).map((r) => <li key={r.field + r.message}><b>{r.field}:</b> {r.message}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
