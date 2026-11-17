// Hands photos picked from the bottom-nav "+" sheet to the page that
// processes them. Module memory survives Next.js client-side navigation,
// which is all this needs: the camera opens inside the user's tap (browsers
// require a gesture), and the destination page picks the files up on mount.
export type PendingTarget = "single" | "batch";

const pending: Partial<Record<PendingTarget, File[]>> = {};

export function setPendingPhotos(target: PendingTarget, files: File[]): void {
  pending[target] = files.slice();
}

/** Returns and clears any photos waiting for `target`. */
export function takePendingPhotos(target: PendingTarget): File[] {
  const files = pending[target] ?? [];
  delete pending[target];
  return files;
}
