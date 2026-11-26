import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { planGate } from "@/lib/billing/entitlements";
import { computePriceSuggestion, type PriceInput } from "@/lib/pricing-suggest";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const gated = await planGate(auth.user.id, "ai");
  if (gated) return gated;
  let input: PriceInput;
  try {
    input = (await req.json()) as PriceInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!input || typeof input !== "object" || Array.isArray(input) || JSON.stringify(input).length > 15_000_000) {
    return NextResponse.json({ error: "Invalid pricing request." }, { status: 400 });
  }
  try {
    return NextResponse.json(await computePriceSuggestion(input));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
