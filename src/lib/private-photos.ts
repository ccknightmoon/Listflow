// Private photos for unpublished drafts (Security 4b). Browser-safe parts.
//
// Off by default. With NEXT_PUBLIC_PRIVATE_DRAFT_PHOTOS=1 (and migration 033
// applied), new uploads go to the PRIVATE bucket `photos-private` instead of
// the public `photos` bucket, and the draft stores a same-origin link:
//     /api/photos/<userId>/<file>.jpg
// The app's <img> tags load that link with the seller's own session; the
// route answers with a short-lived signed URL (src/app/api/photos/...).
// eBay and OpenAI never see these links: the server swaps them for signed
// URLs right before sending (src/lib/private-photos-server.ts).
// Existing public photo URLs keep working unchanged.
export const PRIVATE_BUCKET = "photos-private";
export const PRIVATE_PREFIX = "/api/photos/";

const REF_RE = /^\/api\/photos\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([A-Za-z0-9._-]{1,120})$/i;

export function privatePhotosEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PRIVATE_DRAFT_PHOTOS === "1";
}

export function privatePhotoRef(path: string): string {
  return `${PRIVATE_PREFIX}${path}`;
}

/** Storage path ("userId/file.jpg") of a private photo link, else null. Rejects anything odd ("..", other prefixes). */
export function parsePrivatePhotoRef(u: unknown): { userId: string; path: string } | null {
  if (typeof u !== "string") return null;
  const m = REF_RE.exec(u);
  if (!m || m[2].includes("..")) return null;
  return { userId: m[1].toLowerCase(), path: `${m[1].toLowerCase()}/${m[2]}` };
}

export function isPrivatePhotoRef(u: unknown): u is string {
  return parsePrivatePhotoRef(u) !== null;
}
