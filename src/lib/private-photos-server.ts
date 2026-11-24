// Server side of private draft photos (see src/lib/private-photos.ts).
// Turns /api/photos/... links into short-lived signed Supabase URLs for the
// two outside services that must read the photos: OpenAI (analysis) and eBay
// (publish -- eBay copies the pictures when the listing is created).
import { getServiceClient } from "@/lib/supabase-service";
import { parsePrivatePhotoRef, PRIVATE_BUCKET } from "@/lib/private-photos";

export const OPENAI_URL_TTL_S = 60 * 60; // an hour covers retries/backoff
export const EBAY_URL_TTL_S = 24 * 60 * 60; // eBay fetches at publish; a day is plenty

type Signer = (paths: string[], ttlS: number) => Promise<Array<string | null>>;

const defaultSigner: Signer = async (paths, ttlS) => {
  const { data, error } = await getServiceClient().storage.from(PRIVATE_BUCKET).createSignedUrls(paths, ttlS);
  if (error) throw new Error(`Couldn't sign photo links: ${error.message}`);
  return paths.map((p) => data?.find((d) => d.path === p)?.signedUrl ?? null);
};

/**
 * Same list, with every private link replaced by a signed URL (public URLs
 * and anything else pass through). A private link that can't be signed is
 * dropped rather than sent unreadable. Only links in `onlyUserId`'s folder
 * are signed when given.
 */
export async function externalPhotoUrls(urls: string[], ttlS: number, onlyUserId?: string, signer: Signer = defaultSigner): Promise<string[]> {
  const refs = urls.map((u) => parsePrivatePhotoRef(u));
  const paths = refs.filter((r): r is { userId: string; path: string } => !!r && (!onlyUserId || r.userId === onlyUserId.toLowerCase())).map((r) => r.path);
  if (paths.length === 0) return urls.filter((_, i) => !refs[i]);
  const signed = await signer([...new Set(paths)], ttlS);
  const byPath = new Map([...new Set(paths)].map((p, i) => [p, signed[i]]));
  const out: string[] = [];
  urls.forEach((u, i) => {
    const r = refs[i];
    if (!r) out.push(u);
    else if (!onlyUserId || r.userId === onlyUserId.toLowerCase()) {
      const s = byPath.get(r.path);
      if (s) out.push(s);
    }
  });
  return out;
}

/** Analysis images with private links swapped for signed URLs (this seller's own only). */
export async function resolveImagesForOpenAI<T extends { url?: string }>(images: T[], userId: string, signer?: Signer): Promise<T[]> {
  if (!images.some((img) => parsePrivatePhotoRef(img.url))) return images;
  const out: T[] = [];
  for (const img of images) {
    if (!parsePrivatePhotoRef(img.url)) { out.push(img); continue; }
    const [signed] = await externalPhotoUrls([img.url as string], OPENAI_URL_TTL_S, userId, signer);
    // Unsignable / someone else's link: keep any inline data, drop the link.
    if (signed) out.push({ ...img, url: signed });
    else if ((img as { data?: string }).data) out.push({ ...img, url: undefined });
  }
  return out;
}
