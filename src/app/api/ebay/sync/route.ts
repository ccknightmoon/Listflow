import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { dismissUnlinked, parseState, readSyncState, runSyncPass } from "@/lib/ebay-auto-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

// Background sync with eBay (see src/lib/ebay-auto-sync.ts).
//   GET                       last saved sync state (no eBay call)
//   POST {clientState?}       run a pass now (at most one per 2 min)
//   POST {dismiss: [ids]}     hide items from the "not in Listflow" alert
const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const r = await readSyncState(auth.supabase, auth.user.id);
  return NextResponse.json({ state: r.state, persisted: r.persisted }, { headers: noStore });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const userId = auth.user.id;
  const body = (await req.json().catch(() => ({}))) as { clientState?: unknown; dismiss?: unknown };

  if (Array.isArray(body.dismiss)) {
    const ids = body.dismiss.filter((x): x is string => typeof x === "string" && /^\d{9,15}$/.test(x)).slice(0, 100);
    const saved = await readSyncState(auth.supabase, userId);
    const next = dismissUnlinked(saved.persisted ? saved.state : parseState(body.clientState), ids);
    if (saved.persisted) await auth.supabase.from("app_settings").update({ ebay_sync_state: next }).eq("user_id", userId);
    return NextResponse.json({ state: next, persisted: saved.persisted }, { headers: noStore });
  }

  const connection = await requireEbayConnection(auth).catch(() => null);
  if (!connection) return NextResponse.json({ connected: false }, { headers: noStore });
  try {
    const r = await ebayContext.run(connection, () => runSyncPass(auth.supabase, userId, { clientState: parseState(body.clientState) }));
    return NextResponse.json({ connected: true, ...r }, { headers: noStore });
  } catch (err) {
    return NextResponse.json({ connected: true, error: (err as Error).message }, { status: 200, headers: noStore });
  }
}
