import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { LEARNABLE, MIN_REPEATS } from "@/lib/learned-fixes";

export const runtime = "nodejs";

// The fixes Listflow has seen you make (migration 043). GET lists them;
// DELETE { field, from, to } forgets one.
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { data, error } = await auth.supabase
    .from("ai_corrections")
    .select("field, from_value, to_value, count, updated_at")
    .eq("user_id", auth.user.id)
    .order("count", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ available: false, corrections: [] });
  return NextResponse.json({
    available: true,
    minRepeats: MIN_REPEATS,
    corrections: (data ?? []).map((r) => ({ field: r.field, from: r.from_value, to: r.to_value, count: r.count })),
  });
}

export async function DELETE(req: Request) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const b = (await req.json().catch(() => null)) as { field?: unknown; from?: unknown; to?: unknown } | null;
  if (!b || typeof b.field !== "string" || !(b.field in LEARNABLE) || typeof b.from !== "string" || typeof b.to !== "string") {
    return NextResponse.json({ error: "Pick a fix to forget." }, { status: 400 });
  }
  const { error } = await auth.supabase.from("ai_corrections").delete()
    .eq("user_id", auth.user.id).eq("field", b.field).eq("from_value", b.from).eq("to_value", b.to);
  if (error) return NextResponse.json({ error: "Couldn't forget that fix." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
