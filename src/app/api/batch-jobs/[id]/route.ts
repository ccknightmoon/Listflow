import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

const STATUSES = new Set(["pending", "processing", "paused", "completed", "canceled", "failed"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  let body: { status?: unknown; completedItems?: unknown; failedItems?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (body.status !== undefined && (typeof body.status !== "string" || !STATUSES.has(body.status))) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const { error } = await auth.supabase
    .from("batch_jobs")
    .update({
      ...(body.status !== undefined && { status: body.status }),
      ...(typeof body.completedItems === "number" && { completed_items: Math.floor(body.completedItems) }),
      ...(typeof body.failedItems === "number" && { failed_items: Math.floor(body.failedItems) }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", auth.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
