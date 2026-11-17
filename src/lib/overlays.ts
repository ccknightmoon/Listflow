// Tracks whether any sheet/modal is open, so the bottom nav and publish
// tray can step out of the way (nothing floats over an open sheet).
let count = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openOverlay(): () => void {
  count++;
  emit();
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    count = Math.max(0, count - 1);
    emit();
  };
}

export function anyOverlayOpen(): boolean {
  return count > 0;
}

export function subscribeOverlays(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
