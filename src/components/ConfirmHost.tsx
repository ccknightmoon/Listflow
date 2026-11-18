"use client";

import { useEffect, useRef, useState } from "react";
import { registerConfirmHost, type ConfirmOptions } from "@/lib/confirm";
import Sheet from "@/components/Sheet";

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

  return (
    <Sheet
      open={opts !== null}
      onClose={() => close(false)}
      layer="confirm"
      role="alertdialog"
      labelledBy="confirm-title"
      header={opts ? <p id="confirm-title" className="text-base font-semibold">{opts.title}</p> : null}
      footer={opts ? (
        <div className="flex gap-2">
          {/* Keyboard: destructive confirms start on Cancel, so a stray Enter can't delete. */}
          <button type="button" autoFocus={!!opts.destructive} className="btn flex-1 min-h-[48px]" onClick={() => close(false)}>{opts.cancelLabel ?? "Cancel"}</button>
          <button
            type="button"
            autoFocus={!opts.destructive}
            className="btn flex-1 min-h-[48px] font-semibold"
            style={opts.destructive ? { background: "var(--danger)", color: "white", borderColor: "var(--danger)" } : { background: "var(--accent)", color: "white", borderColor: "var(--accent)" }}
            onClick={() => close(true)}
          >
            {opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      ) : null}
    >
      {opts?.message && <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>{opts.message}</p>}
    </Sheet>
  );
}
