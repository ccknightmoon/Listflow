import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-service";
import {
  challengeResponse,
  deleteEbayUserData,
  getNotificationPublicKey,
  isValidVerificationToken,
  parseDeletionNotification,
  parseSignatureHeader,
  verifyNotificationSignature,
} from "@/lib/ebay-account-deletion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// eBay Marketplace Account Deletion endpoint (see src/lib/ebay-account-deletion.ts).
// Public (no session; listed in src/proxy.ts) and not rate-limited: eBay may
// send bursts. Needs two env vars, both set in Vercel:
//   EBAY_DELETION_VERIFICATION_TOKEN  32–80 chars [A-Za-z0-9_-], the same value
//                                     typed into eBay's developer portal
//   EBAY_DELETION_ENDPOINT            the exact URL registered there, e.g.
//                                     https://listflow-two.vercel.app/api/ebay/account-deletion
function config() {
  const token = process.env.EBAY_DELETION_VERIFICATION_TOKEN;
  const endpoint = process.env.EBAY_DELETION_ENDPOINT;
  if (!isValidVerificationToken(token) || !endpoint || !/^https:\/\//.test(endpoint)) return null;
  return { token, endpoint };
}

export async function GET(req: NextRequest) {
  const cfg = config();
  if (!cfg) return NextResponse.json({ error: "Account-deletion endpoint is not configured." }, { status: 503 });
  const code = req.nextUrl.searchParams.get("challenge_code");
  if (!code || code.length > 512) return NextResponse.json({ error: "challenge_code required" }, { status: 400 });
  return NextResponse.json({ challengeResponse: challengeResponse(code, cfg.token, cfg.endpoint) }, { status: 200, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 64 * 1024) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sig = parseSignatureHeader(req.headers.get("x-ebay-signature"));
  if (!sig) return NextResponse.json({ error: "Missing or invalid signature" }, { status: 412 });
  let verified = false;
  try {
    verified = verifyNotificationSignature(raw, body, sig, await getNotificationPublicKey(sig.kid));
  } catch (err) {
    // Couldn't fetch eBay's key: not acknowledged, so eBay retries later.
    console.error("account-deletion: public key lookup failed:", (err as Error).message);
    return NextResponse.json({ error: "Verification unavailable, retry" }, { status: 503 });
  }
  if (!verified) return NextResponse.json({ error: "Signature verification failed" }, { status: 412 });

  const parsed = parseDeletionNotification(body);
  // Verified but not a deletion (e.g. a future topic): acknowledge, nothing to do.
  if (!parsed) return new NextResponse(null, { status: 204 });

  // A couple of quick database deletes, done before acknowledging: if they
  // fail, eBay gets a 500 and resends, so a deletion is never lost.
  try {
    const { matched } = await deleteEbayUserData(getServiceClient(), parsed.data);
    // No user identifiers in logs.
    console.info(`account-deletion ${parsed.notificationId}: ${matched} Listflow account(s) disconnected and eBay data deleted`);
  } catch (err) {
    console.error(`account-deletion ${parsed.notificationId} failed:`, (err as Error).message);
    return NextResponse.json({ error: "Deletion failed, retry" }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
