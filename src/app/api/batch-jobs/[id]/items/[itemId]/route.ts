import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

const STATUSES = new Set(["pending", "processing", "success", "failed", "skipped"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { id: batchJobId, itemId } = await params;

  let body: { status?: unknown; error?: unknown; draftId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (body.status !== undefined && (typeof body.status !== "string" || !STATUSES.has(body.status))) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const { error } = await auth.supabase
    .from("batch_job_items")
    .update({
      ...(body.status !== undefined && { status: body.status }),
      ...(body.error !== undefined && { error: typeof body.error === "string" ? body.error : null }),
      ...(typeof body.draftId === "string" && body.draftId && { draft_id: body.draftId }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("batch_job_id", batchJobId)
    .eq("user_id", auth.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
