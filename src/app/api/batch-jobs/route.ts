import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

// Durable record of one batch-upload "List all on eBay" / "Retry failed
// listings" run -- see supabase-migrations/022_batch_jobs.sql. Only the
// listing phase writes here; batch-upload's earlier upload/group/analyze/
// review steps still recover via IndexedDB (src/lib/batch-recovery.ts)
// since this schema tracks which drafts got listed and how each one went,
// not photo/grouping state.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  let body: { totalItems?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const totalItems = typeof body.totalItems === "number" && Number.isFinite(body.totalItems) && body.totalItems >= 0
    ? Math.floor(body.totalItems)
    : 0;

  const { data, error } = await auth.supabase
    .from("batch_jobs")
    .insert([{ user_id: auth.user.id, status: "processing", total_items: totalItems }])
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
