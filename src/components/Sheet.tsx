"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Z } from "@/lib/z-layers";
import { anyOverlayOpen, openOverlay, subscribeOverlays } from "@/lib/overlays";

/**
 * The one bottom sheet used everywhere. On desktop (lg+) the same component
 * renders as a centred modal (default) or a right-side drawer
 * (`desktop="drawer"`), still on the same z-layer with the same backdrop. Rendered into <body> (so no page's
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
  desktop = "modal",
  wide = false,
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
  /** Desktop presentation: centred modal, or a full-height drawer on the right. */
  desktop?: "modal" | "drawer";
  /** Wider on desktop (forms with more fields). */
  wide?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const kb = useKeyboardInset(open);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- portal target exists only after mount
  useEffect(() => setMounted(true), []);
  // Latest onClose without re-running the open/close effect every render
  // (inline arrow props would otherwise flicker the nav/tray).
  const closeRef = useRef(onClose);
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const release = openOverlay();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // no background scroll behind the sheet
    // Keyboard: Esc closes; Tab/Shift+Tab stay inside the dialog (focus
    // trap); focus moves into the dialog on open and back to whatever had
    // it (e.g. the row's "⋯" button) on close.
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      // Only the top-most dialog handles keys (a confirm can open on a sheet).
      const dialogs = document.querySelectorAll("[data-sheet-panel]");
      if (panel && dialogs.length && dialogs[dialogs.length - 1] !== panel) return;
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); return; }
      if (e.key === "Tab" && panel) trapTab(e, panel);
    };
    window.addEventListener("keydown", onKey);
    // Move focus in only for mouse/keyboard computers: on phones a
    // programmatic focus could pop the on-screen keyboard unasked.
    const finePointer = typeof window.matchMedia === "function" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const t = window.setTimeout(() => {
      const panel = panelRef.current;
      if (finePointer && panel && !panel.contains(document.activeElement)) {
        (focusablesIn(panel).find((el) => !el.hasAttribute("data-sheet-close")) ?? panel).focus({ preventScroll: true });
      }
    }, 0);
    return () => {
      window.clearTimeout(t);
      release();
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  const node = (
    <div
      className={`fixed inset-0 flex items-end justify-center ${desktop === "drawer" ? "lg:items-stretch lg:justify-end" : "lg:items-center lg:p-8"}`}
      style={{ zIndex: Z[layer] }}
      role={role}
      aria-modal="true"
      aria-label={labelledBy ? undefined : title}
      aria-labelledby={labelledBy}
      data-layer={layer}
    >
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" style={{ background: "rgba(0,0,0,.6)" }} onClick={onClose} />
      <div
        ref={panelRef}
        data-sheet-panel=""
        tabIndex={-1}
        data-desktop={desktop}
        className={`relative w-full max-w-md mx-3 rounded-3xl flex flex-col overflow-hidden outline-none mb-[var(--sheet-mb)] max-h-[var(--sheet-maxh)] ${
          desktop === "drawer"
            ? "lg:mx-0 lg:mb-0 lg:max-h-none lg:h-full lg:rounded-none lg:rounded-l-3xl lg:max-w-[460px]"
            : `lg:mx-0 lg:mb-0 lg:max-h-[85vh] ${wide ? "lg:max-w-2xl" : "lg:max-w-lg"}`
        }`}
        style={{
          ["--sheet-mb" as string]: `calc(12px + ${kb}px)`,
          ["--sheet-maxh" as string]: kb > 0 ? `calc(100dvh - ${kb}px - 24px)` : "90dvh",
          background: "var(--bg-surface)",
          border: "1px solid var(--glass-line)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        {(title || header) && (
          <div className="flex items-start gap-3 px-4 pt-4 pb-2 flex-none">
            <div className="flex-1 min-w-0">{header ?? <p className="text-base font-semibold">{title}</p>}</div>
            <button type="button" data-sheet-close="" onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 -mt-2 flex items-center justify-center rounded-xl flex-none">
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

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focusable elements inside `root`, in DOM order (hidden inputs and file inputs inside labels excluded). */
export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.classList.contains("hidden") && el.getAttribute("aria-hidden") !== "true",
  );
}

/** Keeps Tab / Shift+Tab cycling inside `panel`. */
export function trapTab(e: Pick<KeyboardEvent, "shiftKey" | "preventDefault">, panel: HTMLElement) {
  const items = focusablesIn(panel);
  if (items.length === 0) { e.preventDefault(); panel.focus(); return; }
  const first = items[0], last = items[items.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const inside = !!active && panel.contains(active);
  if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); }
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
