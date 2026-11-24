// Server helpers shared by the /api/jobs routes. Server only.
import { parsePrivatePhotoRef } from "@/lib/private-photos";
import { after } from "next/server";
import { SupabaseJobStore, isQueueMissing, serviceDb } from "./supabase-store";
import { triggerWorker } from "./trigger";

export const QUEUE_UNAVAILABLE = {
  available: false,
  message: "Background processing isn't switched on yet (database migration 029). The batch still works in the app as before.",
};

/** Is migration 029 applied? Cached per instance once it's known to exist. */
let knownAvailable = false;
export async function queueAvailable(): Promise<boolean> {
  if (knownAvailable) return true;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return false;
  const { error } = await serviceDb().from("listing_jobs").select("id").limit(1);
  if (!error) knownAvailable = true;
  else if (!isQueueMissing(error)) console.error("listing_jobs check:", error.message);
  return knownAvailable;
}

export function jobStore() {
  return new SupabaseJobStore();
}

/** Starts the worker after the response is sent (doesn't slow the caller). */
export function kickWorkerAfterResponse(origin: string) {
  after(async () => {
    await triggerWorker(origin);
  });
}

/** Our own uploaded photo for THIS user (photos/<userId>/...). */
export function isUsersPhotoUrl(u: unknown, userId: string): u is string {
  if (typeof u !== "string") return false;
  const priv = parsePrivatePhotoRef(u);
  if (priv) return priv.userId === userId.toLowerCase();
  try {
    const url = new URL(u);
    const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.local");
    return url.protocol === "https:" && url.host === base.host && url.pathname.startsWith(`/storage/v1/object/public/photos/${userId}/`);
  } catch {
    return false;
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
