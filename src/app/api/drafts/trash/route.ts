import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { uuidList } from "@/lib/input-validation";
import { listTrash, purgeTrashNow, restoreDrafts, TRASH_DAYS } from "@/lib/draft-trash";
import { serviceDb } from "@/lib/jobs/supabase-store";

// Recycle bin for drafts (migration 037).
//   GET              what's in the bin (newest first)
//   POST {ids}       restore (Undo)
//   DELETE {ids}     delete for good now (row + unused photos)
const noStore = { "Cache-Control": "no-store" };

async function idsFrom(req: NextRequest): Promise<string[] | null> {
  try {
    return uuidList(((await req.json()) as { ids?: unknown }).ids);
  } catch {
    return null;
  }
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  try {
    const r = await listTrash(auth.supabase, auth.user.id);
    return NextResponse.json({ ...r, days: TRASH_DAYS }, { headers: noStore });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const ids = await idsFrom(req);
  if (!ids) return NextResponse.json({ error: "ids must be a list of 1–500 draft IDs." }, { status: 400 });
  try {
    return NextResponse.json(await restoreDrafts(auth.supabase, auth.user.id, ids), { headers: noStore });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const ids = await idsFrom(req);
  if (!ids) return NextResponse.json({ error: "ids must be a list of 1–500 draft IDs." }, { status: 400 });
  try {
    const storage = process.env.SUPABASE_SERVICE_ROLE_KEY ? serviceDb() : auth.supabase;
    return NextResponse.json(await purgeTrashNow(auth.supabase, storage, auth.user.id, ids, process.env.NEXT_PUBLIC_SUPABASE_URL!), { headers: noStore });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
