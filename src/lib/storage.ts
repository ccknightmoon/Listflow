import { createBrowserClient } from "@supabase/ssr";

// Uses the same cookie-based browser client as login/BottomNav (not the bare
// anon singleton from "./supabase") so the upload actually carries the
// signed-in user's session — required now that the "photos" bucket's INSERT
// policy requires the `authenticated` role instead of `anon`.
const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

export async function uploadThumbnail(dataUrl: string): Promise<string> {
  // Convert data URL directly instead of fetch(dataUrl) — more reliable on Safari
  const [header, b64] = dataUrl.split(",");
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });

  // Photos live under a per-user folder (storage RLS requires the first
  // path segment to equal the caller's auth.uid()) so each user's uploads
  // are isolated the same way their drafts are — see the multi-tenant
  // isolation migration.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const filename = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

  const { error } = await supabase.storage
    .from("photos")
    .upload(filename, blob, { contentType: "image/jpeg", upsert: false });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from("photos").getPublicUrl(filename);
  return data.publicUrl;
}
