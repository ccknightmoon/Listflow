import { NextResponse } from "next/server";
import { fetchStoreCategories } from "@/lib/ebay-store-categories";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  const connection = await requireEbayConnection(auth);
  if (!connection) {
    return NextResponse.json({ categories: [], connect: true });
  }

  return ebayContext.run(connection, async () => {
    try {
      const categories = await fetchStoreCategories();
      return NextResponse.json({ categories });
    } catch (err) {
      return NextResponse.json({ categories: [], error: (err as Error).message });
    }
  });
}
