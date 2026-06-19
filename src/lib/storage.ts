import { supabase } from "./supabase";

export async function uploadThumbnail(dataUrl: string): Promise<string> {
  // Convert data URL directly instead of fetch(dataUrl) — more reliable on Safari
  const [header, b64] = dataUrl.split(",");
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });

  const filename = `public/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

  const { error } = await supabase.storage
    .from("photos")
    .upload(filename, blob, { contentType: "image/jpeg", upsert: false });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from("photos").getPublicUrl(filename);
  return data.publicUrl;
}
