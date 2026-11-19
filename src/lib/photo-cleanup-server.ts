// Production wiring for photo cleanup (service role + eBay GetItem). Server only.
import { serviceDb } from "@/lib/jobs/supabase-store";
import { ebayConnectionForUser } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { tradingRequest } from "@/lib/ebay-inventory";
import { parsePictureUrls, runPhotoCleanup, type CleanupReport } from "@/lib/photo-cleanup";

export async function runPhotoCleanupForUser(userId: string, opts: { force?: boolean } = {}): Promise<CleanupReport> {
  const db = serviceDb();
  const conn = await ebayConnectionForUser(db, userId).catch(() => null);
  return runPhotoCleanup(
    {
      db,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      async ebayPictures(listingId) {
        if (!conn || !/^\d{6,20}$/.test(listingId)) return [];
        return ebayContext.run(conn, async () => {
          const r = await tradingRequest(
            "GetItem",
            `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${listingId}</ItemID><DetailLevel>ItemReturnAttributes</DetailLevel></GetItemRequest>`
          );
          return r.status < 400 ? parsePictureUrls(r.body) : [];
        });
      },
    },
    userId,
    opts
  );
}
