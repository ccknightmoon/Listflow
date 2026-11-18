import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { suggestCategories } from "@/lib/ebay-category";
import { categoryFits, classifyGarment } from "@/lib/garment";

export const runtime = "nodejs";

// Category search for the review screen's "Change category" picker.
// ?q=dallas cowboys jersey&itemType=Jersey&title=… → [{ id, path, fits }]
export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const connection = await requireEbayConnection(auth);
  if (!connection) return NextResponse.json({ error: "eBay not connected.", connect: true, categories: [] }, { status: 200 });
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 120);
  if (q.length < 2) return NextResponse.json({ categories: [] });
  const kind = classifyGarment(sp.get("itemType"), sp.get("title"));
  return ebayContext.run(connection, async () => {
    const list = await suggestCategories(q);
    return NextResponse.json({ categories: list.slice(0, 10).map((c) => ({ ...c, fits: categoryFits(kind, c.path).ok })) });
  });
}
