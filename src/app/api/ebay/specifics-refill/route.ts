import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { refillForCategory } from "@/lib/listing-enrich";
import { sanitizeStoredSpecifics } from "@/lib/item-specifics";

export const runtime = "nodejs";
export const maxDuration = 30;

// "Change category": re-run the specifics for the newly chosen category.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const connection = await requireEbayConnection(auth);
  if (!connection) return NextResponse.json({ error: "eBay not connected.", connect: true }, { status: 200 });
  let body: { categoryId?: unknown; categoryPath?: unknown; title?: unknown; itemType?: unknown; aspects?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const categoryId = typeof body.categoryId === "string" && /^\d{1,12}$/.test(body.categoryId) ? body.categoryId : null;
  if (!categoryId) return NextResponse.json({ error: "categoryId required" }, { status: 400 });
  const aspects = sanitizeStoredSpecifics({ aspects: body.aspects })?.aspects ?? {};
  return ebayContext.run(connection, async () => {
    const r = await refillForCategory(process.env.OPENAI_API_KEY ?? null, {
      categoryId,
      categoryPath: typeof body.categoryPath === "string" ? body.categoryPath.slice(0, 300) : null,
      title: typeof body.title === "string" ? body.title.slice(0, 120) : "",
      itemType: typeof body.itemType === "string" ? body.itemType.slice(0, 60) : null,
      aspects,
    });
    return NextResponse.json(r);
  });
}
