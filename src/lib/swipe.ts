// Gesture maths for swipe-to-reveal row actions (pure, tested).
export const SWIPE_ACTION_WIDTH = 72;

/** Is this movement a horizontal swipe (vs a vertical scroll)? Decided once, after a few px. */
export function isHorizontalIntent(dx: number, dy: number): boolean | null {
  if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return null; // undecided yet
  return Math.abs(dx) > Math.abs(dy) * 1.2;
}

/** Row offset while dragging: only leftwards, with rubber-band past the actions. */
export function dragOffset(startOffset: number, dx: number, actionsWidth: number): number {
  const raw = startOffset + dx;
  if (raw > 0) return 0;
  if (raw < -actionsWidth) return -actionsWidth + (raw + actionsWidth) * 0.25;
  return raw;
}

/** Where the row rests on release: open (show actions) or closed. */
export function settleOffset(offset: number, velocityX: number, actionsWidth: number): number {
  if (velocityX < -0.5) return -actionsWidth; // quick flick left opens
  if (velocityX > 0.5) return 0; // quick flick right closes
  return offset < -actionsWidth / 2 ? -actionsWidth : 0;
}
