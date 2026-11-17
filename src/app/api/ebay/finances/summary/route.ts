import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { fetchTransactionSummary } from "@/lib/ebay-finances";

export const runtime = "nodejs";

// eBay's own transaction_summary for the period on screen, used by the
// Sales page to cross-check its ledger ("Matches eBay" / "Off by $X").
// Read-only. Periods are local-time, so the page passes exact ISO bounds.
const cache = new Map<string, { at: number; value: unknown }>();
const TTL = 10 * 60_000;

export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) {
    return NextResponse.json({ error: "Invalid range." }, { status: 400 });
  }
  const key = `${auth.user.id}:${from}:${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL && sp.get("refresh") !== "1") return NextResponse.json({ summary: hit.value });

  const connection = await requireEbayConnection(auth);
  if (!connection) return NextResponse.json({ summary: null });
  return ebayContext.run(connection, async () => {
    const summary = await fetchTransactionSummary(new Date(from).toISOString(), new Date(to).toISOString());
    if (summary) cache.set(key, { at: Date.now(), value: summary });
    return NextResponse.json({ summary });
  });
}
