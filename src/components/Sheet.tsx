"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Z } from "@/lib/z-layers";
import { anyOverlayOpen, openOverlay, subscribeOverlays } from "@/lib/overlays";

/**
 * The one bottom sheet used everywhere. Rendered into <body> (so no page's
 * stacking context can trap it under the nav), above the nav and tray,
 * with a backdrop that blocks taps behind. Max ~90dvh with its own
 * scroll; the footer (primary button) is pinned and padded for the iPhone
 * home indicator; it lifts above the on-screen keyboard.
 */
export default function Sheet({
  open,
  onClose,
  title,
  header,
  footer,
  children,
  layer = "sheet",
  role = "dialog",
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  header?: ReactNode; // custom header content (replaces title)
  footer?: ReactNode; // pinned at the bottom: primary actions
  children?: ReactNode;
  layer?: "sheet" | "confirm";
  role?: "dialog" | "alertdialog";
  labelledBy?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const kb = useKeyboardInset(open);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- portal target exists only after mount
  useEffect(() => setMounted(true), []);
  // Latest onClose without re-running the open/close effect every render
  // (inline arrow props would otherwise flicker the nav/tray).
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const release = openOverlay();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // no background scroll behind the sheet
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => {
      release();
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open) return null;

  const node = (
    <div
      className="fixed inset-0 flex items-end justify-center"
      style={{ zIndex: Z[layer] }}
      role={role}
      aria-modal="true"
      aria-label={labelledBy ? undefined : title}
      aria-labelledby={labelledBy}
      data-layer={layer}
    >
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" style={{ background: "rgba(0,0,0,.6)" }} onClick={onClose} />
      <div
        className="relative w-full max-w-md mx-3 rounded-3xl flex flex-col overflow-hidden"
        style={{
          marginBottom: `calc(12px + ${kb}px)`,
          maxHeight: kb > 0 ? `calc(100dvh - ${kb}px - 24px)` : "90dvh",
          background: "var(--bg-surface)",
          border: "1px solid var(--glass-line)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        {(title || header) && (
          <div className="flex items-start gap-3 px-4 pt-4 pb-2 flex-none">
            <div className="flex-1 min-w-0">{header ?? <p className="text-base font-semibold">{title}</p>}</div>
            <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 -mt-2 flex items-center justify-center rounded-xl flex-none">
              <X className="w-4 h-4" style={{ color: "var(--text-secondary)" }} />
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-3">{children}</div>
        {footer && (
          <div
            className="flex-none px-4 pt-3"
            style={{
              paddingBottom: kb > 0 ? "12px" : "max(12px, env(safe-area-inset-bottom))",
              borderTop: "1px solid var(--border)",
              background: "var(--bg-surface)",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
  // Into <body> so no page stacking context can trap it under the nav.
  // (Before mount -- server render / tests -- it renders in place.)
  return mounted ? createPortal(node, document.body) : node;
}

/** Height of the on-screen keyboard (iOS/Android) while `active`, via visualViewport. */
export function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!active || !vv) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      setInset(0);
    };
  }, [active]);
  return inset;
}

/** True while any sheet/modal is open (nav + tray hide themselves). */
export function useAnyOverlayOpen(): boolean {
  return useSyncExternalStore(subscribeOverlays, anyOverlayOpen, () => false);
}
