import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET() {
  const { data, error } = await supabase
    .from("drafts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ drafts: data });
}

export async function DELETE(req: NextRequest) {
  let body: { ids?: string[] };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const ids = body.ids ?? [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "No ids provided." }, { status: 400 });
  }

  const { error } = await supabase.from("drafts").delete().in("id", ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: ids.length });
}

export async function POST(req: NextRequest) {
  let body;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("drafts")
    .insert([
      {
        title: body.title ?? null,
        brand: body.brand ?? null,
        color: body.color ?? null,
        size: body.size ?? null,
        condition: body.condition ?? null,
        flaws: body.flaws ?? null,
        suggested_price: body.suggestedPrice ?? null,
        avg_sold: body.avgSold ?? null,
        active_range_low: body.activeRangeLow ?? null,
        active_range_high: body.activeRangeHigh ?? null,
        sell_odds: body.sellOdds ?? null,
        thumbnail_url: body.thumbnailUrl ?? null,
        photo_urls: body.photoUrls ?? null,
      },
    ])
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ draft: data[0] });
}
