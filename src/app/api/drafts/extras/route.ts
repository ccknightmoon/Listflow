import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { uuidList } from "@/lib/input-validation";
import { normalizeBin } from "@/lib/bins";
import { isMissingRelation } from "@/lib/hauls";

export const runtime = "nodejs";

// Small per-item extras that live in their own columns (migrations 041/042)
// and are kept out of the main draft save on purpose, so a missing
// migration can never break saving a draft:
//   { ids: uuid[], binLocation?: string | null, autoOfferOptIn?: boolean }
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase, user } = auth;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  const ids = uuidList(body.ids);
  if (!ids) return NextResponse.json({ error: "ids must be 1–500 item ids." }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (body.binLocation !== undefined) {
    const bin = normalizeBin(body.binLocation);
    if (bin === undefined) return NextResponse.json({ error: "Bin must be up to 24 characters (e.g. B3)." }, { status: 400 });
    patch.bin_location = bin;
  }
  if (body.autoOfferOptIn !== undefined) {
    if (typeof body.autoOfferOptIn !== "boolean") return NextResponse.json({ error: "autoOfferOptIn must be true or false." }, { status: 400 });
    patch.auto_offer_opt_in = body.autoOfferOptIn;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  const { data, error } = await supabase.from("drafts").update(patch).in("id", ids).eq("user_id", user.id).select("id");
  if (error) {
    if (isMissingRelation(error, "bin_location|auto_offer_opt_in")) {
      return NextResponse.json({ error: "This needs a one-time database update (migrations 041/042).", needsMigration: true }, { status: 409 });
    }
    return NextResponse.json({ error: "Couldn't save." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, updated: data?.length ?? 0 });
}
