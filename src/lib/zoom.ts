// Pan/zoom math for the full-screen photo viewer. Pure so it's tested.
export interface View { scale: number; x: number; y: number } // translate in px, from centre

export const MIN_SCALE = 1;
export const MAX_SCALE = 5;
export const DOUBLE_TAP_SCALE = 2.5;

export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/**
 * Zoom to `nextScale` keeping the point under the finger/cursor still.
 * `px,py` are the point relative to the viewport centre.
 */
export function zoomAt(v: View, nextScale: number, px: number, py: number): View {
  const s = clampScale(nextScale);
  if (s === MIN_SCALE) return { scale: 1, x: 0, y: 0 };
  const k = s / v.scale;
  return { scale: s, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
}

/** Keep the image covering the viewport edges it can (no panning into empty space). */
export function clampPan(v: View, viewW: number, viewH: number, imgW: number, imgH: number): View {
  if (v.scale <= 1) return { scale: 1, x: 0, y: 0 };
  const maxX = Math.max(0, (imgW * v.scale - viewW) / 2);
  const maxY = Math.max(0, (imgH * v.scale - viewH) / 2);
  return { scale: v.scale, x: Math.max(-maxX, Math.min(maxX, v.x)), y: Math.max(-maxY, Math.min(maxY, v.y)) };
}

/** Double-tap / click: zoom in at the point, or back out if already zoomed. */
export function toggleZoom(v: View, px: number, py: number): View {
  return v.scale > 1.05 ? { scale: 1, x: 0, y: 0 } : zoomAt(v, DOUBLE_TAP_SCALE, px, py);
}

/** Wheel delta → new scale (smooth, trackpad-friendly). */
export function wheelScale(scale: number, deltaY: number): number {
  return clampScale(scale * Math.exp(-deltaY * 0.0025));
}

/** A horizontal swipe at scale 1 that should change photo: -1 prev, 1 next, 0 none. */
export function swipeDirection(dx: number, dy: number, dtMs: number): -1 | 0 | 1 {
  if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  if (Math.abs(dx) / Math.max(dtMs, 1) < 0.1 && Math.abs(dx) < 120) return 0;
  return dx < 0 ? 1 : -1;
}

export const wrapIndex = (i: number, n: number) => (n <= 0 ? 0 : ((i % n) + n) % n);
