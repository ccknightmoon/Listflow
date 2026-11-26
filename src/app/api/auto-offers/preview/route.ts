import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { runAutoOffers } from "@/lib/auto-offers-server";

export const runtime = "nodejs";
export const maxDuration = 30;

// Read-only preview: "if automatic offers ran now, who would get what?"
// Calls eBay only to READ (interested buyers, current prices). Never sends.
// Shown even while the setting is off, as "what would happen if ON".
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const connection = await requireEbayConnection(auth);
  if (!connection) return NextResponse.json({ available: false, reason: "Connect eBay first." });
  const run = await runAutoOffers({ db: auth.supabase as never, connection }, auth.user.id, { send: false, settingsOverride: { enabled: true } });
  const { data: log } = await auth.supabase
    .from("auto_offer_log")
    .select("ebay_listing_id, discount_percent, list_price, offer_price, status, detail, created_at")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  return NextResponse.json({ ...run, log: log ?? [] });
}
