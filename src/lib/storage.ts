import { createBrowserClient } from "@supabase/ssr";

// Uses the same cookie-based browser client as login/BottomNav (not the bare
// anon singleton from "./supabase") so the upload actually carries the
// signed-in user's session — required now that the "photos" bucket's INSERT
// policy requires the `authenticated` role instead of `anon`.
const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

// A batch-upload session can call uploadThumbnail() 100+ times (several
// photos per item, times 40+ items), and it used to call
// supabase.auth.getUser() fresh every single time -- a real network round
// trip to Supabase's Auth server to revalidate the JWT, not a local read.
// The signed-in user can't change mid-session without a hard navigation
// (every sign-out in this app does `window.location.href = "/login"`,
// which resets all in-memory JS state including this cache), so it's safe
// to resolve it once and reuse it for the rest of the page's life. The
// in-flight promise is cached too (not just the resolved id) so the first
// wave of concurrent uploads in a batch don't all fire their own redundant
// getUser() call before the first one resolves.
let cachedUserIdPromise: Promise<string> | null = null;

function getCachedUserId(): Promise<string> {
  if (!cachedUserIdPromise) {
    cachedUserIdPromise = supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        cachedUserIdPromise = null; // don't cache a failure -- a later call may succeed
        throw new Error("Not signed in.");
      }
      return user.id;
    });
  }
  return cachedUserIdPromise;
}

export async function uploadThumbnail(dataUrl: string): Promise<string> {
  // Convert data URL directly instead of fetch(dataUrl) -- more reliable on Safari
  const [header, b64] = dataUrl.split(",");
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });

  // Photos live under a per-user folder (storage RLS requires the first
  // path segment to equal the caller's auth.uid()) so each user's uploads
  // are isolated the same way their drafts are -- see the multi-tenant
  // isolation migration.
  const userId = await getCachedUserId();
  const filename = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

  const { error } = await supabase.storage
    .from("photos")
    .upload(filename, blob, { contentType: "image/jpeg", upsert: false });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from("photos").getPublicUrl(filename);
  return data.publicUrl;
}
