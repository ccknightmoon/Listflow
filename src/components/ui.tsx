"use client";

// Shared building blocks in the Sales page's style, so every screen loads,
// empties and explains things the same way.
import type { ReactNode } from "react";

/** Content-shaped loading rows (thumbnail + two lines + amount). */
export function ListSkeleton({ rows = 5, label }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={label ?? "Loading"} className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card p-3 flex items-center gap-3 animate-pulse" style={{ opacity: 1 - i * 0.12 }}>
          <div className="w-12 h-12 rounded-md flex-none" style={{ background: "var(--glass-strong)" }} />
          <div className="flex-1 flex flex-col gap-2">
            <div className="h-3 rounded-full w-3/4" style={{ background: "var(--glass-strong)" }} />
            <div className="h-2.5 rounded-full w-1/3" style={{ background: "var(--glass)" }} />
          </div>
          <div className="h-3.5 rounded-full w-12" style={{ background: "var(--glass-strong)" }} />
        </div>
      ))}
      {label && <p className="text-xs text-center mt-1" style={{ color: "var(--text-tertiary)" }}>{label}</p>}
    </div>
  );
}

/** Friendly empty state with an optional action. */
export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="card p-8 text-center flex flex-col items-center gap-2">
      {icon && <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-1" style={{ background: "var(--accent-tint)", color: "var(--accent)" }}>{icon}</div>}
      <p className="text-sm font-semibold">{title}</p>
      {body && <p className="text-xs leading-relaxed max-w-[260px]" style={{ color: "var(--text-secondary)" }}>{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Loading shape for an edit screen: photo strip + form fields (no layout jump when it fills in). */
export function EditorSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3 animate-pulse">
      <div className="flex gap-3">
        {[0, 1, 2].map((i) => <div key={i} className="w-24 h-24 rounded-xl flex-none" style={{ background: "var(--glass-strong)" }} />)}
      </div>
      {[80, 60, 70, 45].map((w, i) => (
        <div key={i} className="card p-3 flex flex-col gap-2">
          <div className="h-2.5 rounded-full w-1/4" style={{ background: "var(--glass)" }} />
          <div className="h-3.5 rounded-full" style={{ width: `${w}%`, background: "var(--glass-strong)" }} />
        </div>
      ))}
    </div>
  );
}
