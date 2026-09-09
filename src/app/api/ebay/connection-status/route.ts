import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";

export const runtime = "nodejs";

// A single cheap Supabase row lookup (see requireEbayConnection -- no
// eBay API call at all), so it's safe to check on every batch-upload page
// load. Deliberately does NOT confirm the stored token still works (that
// would mean an actual eBay call) -- it only answers "has this account
// connected eBay at all," which is exactly the case batch-upload wants to
// warn about early: a seller who never connected (or disconnected) eBay
// discovering that after reviewing 30+ items, not before. A connected-but-
// expired token is still only caught at listing time, same as before.
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  const connection = await requireEbayConnection(auth);
  return NextResponse.json({ connected: !!connection });
}
