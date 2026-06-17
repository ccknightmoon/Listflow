import { supabase } from "./supabase";

export async function uploadThumbnail(dataUrl: string): Promise<string> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const filename = `public/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

  const { error } = await supabase.storage
    .from("photos")
    .upload(filename, blob, { contentType: "image/jpeg", upsert: false });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from("photos").getPublicUrl(filename);
  return data.publicUrl;
}
