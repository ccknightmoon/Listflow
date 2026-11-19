import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { publishDraft, type PublishBody } from "@/lib/publish-draft";

export const runtime = "nodejs";

// Publishing logic lives in src/lib/publish-draft.ts so the background
// queue worker can run exactly the same code.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  let body: PublishBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body?.draftId) return NextResponse.json({ error: "draftId required" }, { status: 400 });

  const connection = await requireEbayConnection(auth);
  return publishDraft({ supabase: auth.supabase, userId: auth.user.id, connection }, body);
}
