import { createBrowserClient } from "@supabase/ssr";

// Uses the same cookie-based browser client as login/BottomNav (not the bare
// anon singleton from "./supabase") so the upload actually carries the
// signed-in user's session — required now that the "photos" bucket's INSERT
// policy requires the `authenticated` role instead of `anon`.
const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

export const safeStorage = {
  isAvailable() {
    if (typeof window === "undefined") return false;

    try {
      const testKey = "__listflow_storage__";
      window.localStorage.setItem(testKey, "ok");
      window.localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  },

  get<T = string>(key: string, fallback?: T): T | undefined {
    if (!this.isAvailable()) return fallback;

    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : (value as unknown as T);
    } catch {
      return fallback;
    }
  },

  getJSON<T>(key: string, fallback?: T): T | undefined {
    const raw = this.get<string | null>(key, null);
    if (raw === null || typeof raw === "undefined") return fallback;

    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },

  set<T>(key: string, value: T): boolean {
    if (!this.isAvailable()) return false;

    try {
      const payload = typeof value === "string" ? value : JSON.stringify(value);
      window.localStorage.setItem(key, payload);
      return true;
    } catch {
      return false;
    }
  },

  remove(key: string): boolean {
    if (!this.isAvailable()) return false;

    try {
      window.localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },
};

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
