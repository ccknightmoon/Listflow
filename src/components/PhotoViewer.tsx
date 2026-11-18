"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from "lucide-react";
import { Z } from "@/lib/z-layers";
import { openOverlay } from "@/lib/overlays";
import { clampPan, swipeDirection, toggleZoom, wheelScale, wrapIndex, zoomAt, type View } from "@/lib/zoom";

const IDENTITY: View = { scale: 1, x: 0, y: 0 };

/**
 * Full-screen photo viewer, on the sheet layer (above nav/tray, below
 * confirms/toasts). Phone: pinch and double-tap to zoom, drag to pan,
 * swipe between photos. Computer: wheel or click to zoom, drag to pan,
 * ←/→ between photos. Esc / ✕ / tapping the dark area closes.
 */
export default function PhotoViewer({
  photos,
  index,
  onClose,
  onIndexChange,
  alt = "Photo",
}: {
  photos: string[];
  /** Open at this photo; null = closed. */
  index: number | null;
  onClose: () => void;
  onIndexChange?: (i: number) => void;
  alt?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [i, setI] = useState(index ?? 0);
  const [view, setView] = useState<View>(IDENTITY);
  const [dragging, setDragging] = useState(false);
  const stage = useRef<HTMLDivElement | null>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startDist?: number; startView?: View; startX?: number; startY?: number; t0?: number; moved?: boolean; panFrom?: View } | null>(null);
  const lastTap = useRef(0);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  const open = index !== null && photos.length > 0;
  const n = photos.length;

  // eslint-disable-next-line react-hooks/set-state-in-effect -- portal target exists only after mount
  useEffect(() => setMounted(true), []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- sync to the photo the caller opened
  useEffect(() => { if (index !== null) { setI(index); setView(IDENTITY); } }, [index]);

  const go = (delta: number) => {
    if (n < 2) return;
    const next = wrapIndex(i + delta, n);
    setI(next);
    setView(IDENTITY);
    onIndexChange?.(next);
  };
  const goRef = useRef(go);
  useEffect(() => { goRef.current = go; });

  useEffect(() => {
    if (!open) return;
    const release = openOverlay();
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goRef.current(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); goRef.current(-1); }
      else if (e.key === "+" || e.key === "=") setView((v) => zoomAt(v, v.scale * 1.5, 0, 0));
      else if (e.key === "-") setView((v) => zoomAt(v, v.scale / 1.5, 0, 0));
    };
    window.addEventListener("keydown", onKey, true);
    const t = window.setTimeout(() => document.getElementById("photo-viewer-close")?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      release();
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const rel = (cx: number, cy: number) => {
    const r = stage.current?.getBoundingClientRect();
    if (!r) return { px: 0, py: 0 };
    return { px: cx - (r.left + r.width / 2), py: cy - (r.top + r.height / 2) };
  };
  const clamp = (v: View) => {
    const r = stage.current?.getBoundingClientRect();
    const im = img.current;
    if (!r || !im) return v;
    return clampPan(v, r.width, r.height, im.clientWidth, im.clientHeight);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setDragging(true);
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      gesture.current = { startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), startView: view, moved: true };
    } else {
      gesture.current = { startX: e.clientX, startY: e.clientY, t0: e.timeStamp, moved: false, panFrom: view };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && g.startDist && g.startView) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const { px, py } = rel((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      setView(clamp(zoomAt(g.startView, g.startView.scale * (d / g.startDist), px, py)));
      return;
    }
    const dx = e.clientX - (g.startX ?? 0), dy = e.clientY - (g.startY ?? 0);
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) g.moved = true;
    if (g.panFrom && g.panFrom.scale > 1) setView(clamp({ ...g.panFrom, x: g.panFrom.x + dx, y: g.panFrom.y + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return;
    gesture.current = null;
    setDragging(false);
    if (!g || g.startDist) return;
    const dx = e.clientX - (g.startX ?? 0), dy = e.clientY - (g.startY ?? 0);
    if (g.moved) {
      if (view.scale <= 1) {
        const dir = swipeDirection(dx, dy, e.timeStamp - (g.t0 ?? e.timeStamp));
        if (dir) go(dir);
        else if (dy > 120 && Math.abs(dx) < 60) onClose(); // swipe down to close
      }
      return;
    }
    // A tap/click: on the dark background closes; on the photo zooms
    // (double-tap on touch, single click with a mouse).
    const onImage = (e.target as HTMLElement) === img.current;
    if (!onImage && view.scale <= 1) { onClose(); return; }
    const { px, py } = rel(e.clientX, e.clientY);
    if (e.pointerType === "mouse") { setView(clamp(toggleZoom(view, px, py))); return; }
    const now = e.timeStamp;
    if (now - lastTap.current < 300) { setView(clamp(toggleZoom(view, px, py))); lastTap.current = 0; }
    else lastTap.current = now;
  };
  const onWheel = (e: React.WheelEvent) => {
    const { px, py } = rel(e.clientX, e.clientY);
    setView((v) => clamp(zoomAt(v, wheelScale(v.scale, e.deltaY), px, py)));
  };

  const btn = "w-11 h-11 rounded-full flex items-center justify-center text-white bg-black/50 hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";
  const node = (
    <div className="fixed inset-0 bg-black/95 select-none" style={{ zIndex: Z.sheet }} role="dialog" aria-modal="true" aria-label={`${alt} ${i + 1} of ${n}`} data-testid="photo-viewer">
      <div
        ref={stage}
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        style={{ touchAction: "none", cursor: view.scale > 1 ? "grab" : "zoom-in" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => { pointers.current.delete(e.pointerId); gesture.current = null; setDragging(false); }}
        onWheel={onWheel}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={img}
          key={photos[i]}
          src={photos[i]}
          alt={`${alt} ${i + 1}`}
          draggable={false}
          className="max-w-full max-h-full object-contain"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transition: dragging ? "none" : "transform .18s ease" }}
        />
      </div>
      <div className="absolute left-0 right-0 flex items-center justify-between px-3 pointer-events-none" style={{ top: "max(12px, env(safe-area-inset-top))" }}>
        <span className="text-white/80 text-sm font-medium pointer-events-none">{n > 1 ? `${i + 1} / ${n}` : ""}</span>
        <div className="flex gap-2 pointer-events-auto">
          <button type="button" className={`${btn} hidden lg:flex`} aria-label="Zoom out" onClick={() => setView((v) => clamp(zoomAt(v, v.scale / 1.5, 0, 0)))}><ZoomOut className="w-5 h-5" /></button>
          <button type="button" className={`${btn} hidden lg:flex`} aria-label="Zoom in" onClick={() => setView((v) => clamp(zoomAt(v, v.scale * 1.5, 0, 0)))}><ZoomIn className="w-5 h-5" /></button>
          <button type="button" id="photo-viewer-close" className={btn} aria-label="Close photo" onClick={onClose}><X className="w-6 h-6" /></button>
        </div>
      </div>
      {n > 1 && (
        <>
          <button type="button" className={`${btn} absolute left-3 top-1/2 -translate-y-1/2`} aria-label="Previous photo" onClick={() => go(-1)}><ChevronLeft className="w-6 h-6" /></button>
          <button type="button" className={`${btn} absolute right-3 top-1/2 -translate-y-1/2`} aria-label="Next photo" onClick={() => go(1)}><ChevronRight className="w-6 h-6" /></button>
        </>
      )}
    </div>
  );
  // Into <body> so no page stacking context traps it (in place before mount / in tests).
  return mounted ? createPortal(node, document.body) : node;
}
