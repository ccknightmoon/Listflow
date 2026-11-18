"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Z } from "@/lib/z-layers";
import { openOverlay } from "@/lib/overlays";

/** Full-screen photo viewer, above everything (portal + sheet layer). */
export default function Lightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- portal target exists only after mount
  useEffect(() => setMounted(true), []);
  useEffect(() => (src ? openOverlay() : undefined), [src]);
  // Keyboard: Esc closes; focus goes to the close button while open and
  // back to whatever opened it afterwards.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!src) return;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); } };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => document.getElementById("lightbox-close")?.focus(), 0);
    return () => { window.clearTimeout(t); window.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, [src]);
  if (!src || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center" style={{ zIndex: Z.sheet }} onClick={onClose} role="dialog" aria-modal="true" aria-label="Photo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="max-w-full max-h-full object-contain" draggable={false} />
      <button
        type="button"
        id="lightbox-close"
        onClick={onClose}
        aria-label="Close photo"
        className="absolute right-4 w-11 h-11 flex items-center justify-center text-white bg-black/40 rounded-full"
        style={{ top: "max(16px, env(safe-area-inset-top))" }}
      >
        <X className="w-6 h-6" />
      </button>
    </div>,
    document.body,
  );
}
