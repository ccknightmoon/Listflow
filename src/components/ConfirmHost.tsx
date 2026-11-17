"use client";

import { useEffect, useRef, useState } from "react";
import { registerConfirmHost, type ConfirmOptions } from "@/lib/confirm";

// The single styled confirm sheet for the whole app (see src/lib/confirm.ts).
export default function ConfirmHost() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    registerConfirmHost((o) => new Promise<boolean>((resolve) => {
      resolver.current?.(false); // a newer request cancels an open one
      resolver.current = resolve;
      setOpts(o);
    }));
    return () => registerConfirmHost(null);
  }, []);

  function close(ok: boolean) {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  }

  if (!opts) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <button type="button" aria-label="Cancel" className="absolute inset-0" style={{ background: "rgba(0,0,0,.55)" }} onClick={() => close(false)} />
      <div
        className="relative w-full max-w-md mx-3 mb-3 rounded-3xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--glass-line)", boxShadow: "var(--shadow-card)" }}
      >
        <p id="confirm-title" className="text-base font-semibold">{opts.title}</p>
        {opts.message && <p className="text-sm mt-1.5 leading-relaxed" style={{ color: "var(--text-secondary)" }}>{opts.message}</p>}
        <div className="flex gap-2 mt-5">
          <button type="button" className="btn flex-1" onClick={() => close(false)}>{opts.cancelLabel ?? "Cancel"}</button>
          <button
            type="button"
            autoFocus
            className="btn flex-1 font-semibold"
            style={opts.destructive ? { background: "var(--danger)", color: "white", borderColor: "var(--danger)" } : { background: "var(--accent)", color: "white", borderColor: "var(--accent)" }}
            onClick={() => close(true)}
          >
            {opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
