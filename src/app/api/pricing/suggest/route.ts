import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { computePriceSuggestion, type PriceInput } from "@/lib/pricing-suggest";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const input = (await req.json()) as PriceInput;
  try {
    return NextResponse.json(await computePriceSuggestion(input));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
