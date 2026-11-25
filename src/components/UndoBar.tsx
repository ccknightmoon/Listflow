"use client";

import { useEffect } from "react";
import { Z } from "@/lib/z-layers";

// "Moved to Recently deleted · Undo" -- floats above the bottom nav so it's
// visible wherever the seller deleted from. Dismisses itself after `ms`.
export default function UndoBar({ message, onUndo, onClose, busy = false, ms = 10_000 }: { message: string | null; onUndo: () => void; onClose: () => void; busy?: boolean; ms?: number }) {
  useEffect(() => {
    if (!message || busy) return;
    const t = setTimeout(onClose, ms);
    return () => clearTimeout(t);
  }, [message, busy, ms, onClose]);
  if (!message) return null;
  return (
    <div
      role="status"
      className="fixed left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md flex items-center gap-3 rounded-xl px-4 py-3 text-sm"
      style={{
        zIndex: Z.toast,
        bottom: "calc(var(--nav-space, 0px) + var(--tray-offset, 0px) + 12px)",
        background: "var(--glass-strong)",
        border: "1px solid var(--glass-line)",
        boxShadow: "var(--shadow-card)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        animation: "rise .3s var(--spring) both",
      }}
    >
      <span className="flex-1 min-w-0">{message}</span>
      <button type="button" onClick={onUndo} disabled={busy} className="font-semibold shrink-0" style={{ color: "var(--accent)" }}>
        {busy ? "Restoring…" : "Undo"}
      </button>
      <button type="button" aria-label="Dismiss" onClick={onClose} className="shrink-0 opacity-70">×</button>
    </div>
  );
}
