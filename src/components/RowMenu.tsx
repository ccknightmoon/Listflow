"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { Z } from "@/lib/z-layers";
import { clampMenuPosition } from "@/lib/row-keys";

export interface RowAction {
  label: string;
  icon?: ReactNode;
  tone?: "accent" | "danger" | "neutral";
  /** Either a handler… */
  onAction?: () => void;
  /** …or a link (external links open in a new tab). */
  href?: string;
  external?: boolean;
  disabled?: boolean;
}

const TONE = { accent: "var(--accent)", danger: "var(--danger)", neutral: "var(--text-primary)" };

/**
 * Desktop row actions menu: opened by the "⋯" button, a right-click, or
 * Shift+F10 / the Menu key on a focused row. Arrow keys move, Enter
 * activates, Esc / Tab / click outside closes and focus returns to the row.
 */
export function RowMenu({ actions, at, onClose, label = "Actions" }: { actions: RowAction[]; at: { x: number; y: number } | null; onClose: () => void; label?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState(at);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    if (!at || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos(clampMenuPosition(at.x, at.y, r.width, r.height, window.innerWidth, window.innerHeight));
    ref.current.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const opener = document.activeElement as HTMLElement | null;
    const close = () => closeRef.current();
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => {
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); close(); opener?.focus(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
      else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
      else if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [at]);

  if (!at) return null;
  const p = pos ?? at;
  const item = "w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-sm text-left outline-none hover:bg-[var(--glass)] focus-visible:bg-[var(--accent-tint)] aria-disabled:opacity-40";
  const node = (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="fixed min-w-[200px] p-1.5 rounded-xl"
      style={{ left: p.x, top: p.y, zIndex: Z.menu, background: "var(--bg-surface)", border: "1px solid var(--glass-line)", boxShadow: "var(--shadow-card)" }}
    >
      {actions.map((a) => {
        const content = (<>{a.icon && <span className="w-4 h-4 flex items-center justify-center">{a.icon}</span>}<span>{a.label}</span></>);
        const style = { color: TONE[a.tone ?? "neutral"] };
        return a.href ? (
          <a key={a.label} role="menuitem" tabIndex={-1} href={a.href} target={a.external ? "_blank" : undefined} rel={a.external ? "noopener noreferrer" : undefined} className={item} style={style} onClick={() => onClose()}>
            {content}
          </a>
        ) : (
          <button key={a.label} type="button" role="menuitem" tabIndex={-1} aria-disabled={a.disabled || undefined} className={item} style={style}
            onClick={() => { if (a.disabled) return; onClose(); a.onAction?.(); }}>
            {content}
          </button>
        );
      })}
    </div>
  );
  return typeof document === "undefined" ? node : createPortal(node, document.body);
}

/** The "⋯" button that opens a RowMenu below itself. */
export function RowMenuButton({ onOpen, label = "More actions" }: { onOpen: (at: { x: number; y: number }) => void; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        onOpen({ x: r.right - 200, y: r.bottom + 4 });
      }}
      className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--glass)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
      style={{ color: "var(--text-secondary)" }}
    >
      <MoreHorizontal className="w-4 h-4" />
    </button>
  );
}
