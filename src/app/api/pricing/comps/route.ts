import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { findComps } from "@/lib/pricing-comps";
import { estimateShipping } from "@/lib/shipping";
import { fetchOwnPhotoBase64 } from "@/lib/jobs/processors";
import { isUuid } from "@/lib/input-validation";

export const runtime = "nodejs";

// Price range from comparable ACTIVE eBay listings for one draft, weighted
// by brand, size and condition (src/lib/comp-weighting.ts). Read-only and a
// suggestion only: nothing here changes the draft's price.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  let body: { draftId?: unknown; useImage?: unknown; title?: unknown; brand?: unknown; size?: unknown; condition?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!isUuid(body.draftId)) return NextResponse.json({ error: "draftId required" }, { status: 400 });
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    return NextResponse.json({ error: "eBay isn't configured on the server." }, { status: 503 });
  }

  const { data: d, error } = await auth.supabase
    .from("drafts")
    .select("title, brand, size, condition, item_type, material, photo_urls, thumbnail_url")
    .eq("id", body.draftId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (error || !d) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  // What's on screen right now (possibly unsaved) wins over the saved row.
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : undefined);
  d.title = text(body.title, 500) ?? d.title;
  d.brand = text(body.brand, 200) ?? d.brand;
  d.size = text(body.size, 100) ?? d.size;
  d.condition = text(body.condition, 100) ?? d.condition;
  if (!d.title) return NextResponse.json({ error: "Add a title first — it's what eBay is searched with." }, { status: 400 });

  const firstPhoto = (d.photo_urls as string[] | null)?.[0] ?? d.thumbnail_url ?? null;
  const imageBase64 = body.useImage !== false && firstPhoto
    ? await fetchOwnPhotoBase64(firstPhoto, auth.user.id).catch(() => undefined)
    : undefined;

  try {
    const { summary, query } = await findComps({
      title: d.title,
      brand: d.brand,
      size: d.size,
      condition: d.condition,
      estShipping: estimateShipping(d.item_type, d.size, d.material).cost,
      imageBase64,
    });
    return NextResponse.json({ summary, query }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
