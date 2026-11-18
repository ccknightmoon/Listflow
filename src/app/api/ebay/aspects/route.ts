import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { fetchAspectDefs, defsForClient } from "@/lib/ebay-aspects";
import { chooseCategory } from "@/lib/ebay-category";

export const runtime = "nodejs";

// Item-specifics definitions for the review/edit screens:
//   ?categoryId=57988            → that category
//   ?title=…&itemType=…          → the category publishing would pick
export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const connection = await requireEbayConnection(auth);
  if (!connection) return NextResponse.json({ error: "eBay not connected.", connect: true, defs: [] }, { status: 200 });
  const sp = new URL(req.url).searchParams;
  const given = sp.get("categoryId");
  return ebayContext.run(connection, async () => {
    const pick = given && /^\d+$/.test(given)
      ? null
      : await chooseCategory({ title: sp.get("title"), itemType: sp.get("itemType") }).catch(() => null);
    const categoryId = given && /^\d+$/.test(given) ? given : pick?.categoryId ?? null;
    if (!categoryId) return NextResponse.json({ categoryId: null, defs: [] });
    const defs = await fetchAspectDefs(categoryId);
    return NextResponse.json(
      { categoryId, categoryPath: pick?.categoryPath ?? null, categoryNeedsReview: pick?.needsReview ?? false, defs: defsForClient(defs) },
      { headers: { "Cache-Control": "private, max-age=3600" } },
    );
  });
}
