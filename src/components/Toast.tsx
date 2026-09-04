"use client";

import { useEffect, useRef, useState } from "react";

type ToastProps = {
  message: React.ReactNode;
  type?: "info" | "success" | "error";
  onClose?: () => void;
};

// How long the exit animation plays before the toast actually leaves the
// DOM. Toast stays mounted at all times now — callers pass `message={null}`
// (or an empty string) to dismiss it instead of unmounting the component —
// so this works the same whether dismissal comes from the X button's
// onClose or an unrelated auto-dismiss timer in the parent page.
const EXIT_MS = 220;

export default function Toast({ message, type = "info", onClose }: ToastProps) {
  const [rendered, setRendered] = useState<React.ReactNode>(message);
  const [closing, setClosing] = useState(false);
  const hadMessage = useRef(Boolean(message));

  useEffect(() => {
    if (message) {
      hadMessage.current = true;
      setRendered(message);
      setClosing(false);
      return;
    }
    if (hadMessage.current) {
      hadMessage.current = false;
      setClosing(true);
      const t = setTimeout(() => setRendered(null), EXIT_MS);
      return () => clearTimeout(t);
    }
  }, [message]);

  if (!rendered) return null;

  const color = {
    info: "var(--accent)",
    success: "var(--success)",
    error: "var(--danger)",
  }[type];

  return (
    <div className="mb-4">
      <div
        className="flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2 text-sm"
        style={{
          background: "var(--glass-strong)",
          border: `1px solid ${color}`,
          color: "var(--text-primary)",
          boxShadow: "var(--shadow-card)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          animation: closing ? "toast-out .22s ease both" : "rise .3s var(--spring) both",
        }}
      >
        <span className="block leading-5">{rendered}</span>
        {onClose && (
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={onClose}
            className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
            style={{ color: "var(--text-primary)" }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
