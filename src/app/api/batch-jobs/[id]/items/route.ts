import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { id: batchJobId } = await params;

  let body: { draftId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const draftId = typeof body.draftId === "string" && body.draftId ? body.draftId : null;

  const { data, error } = await auth.supabase
    .from("batch_job_items")
    .insert([{ batch_job_id: batchJobId, user_id: auth.user.id, draft_id: draftId, status: "processing" }])
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
