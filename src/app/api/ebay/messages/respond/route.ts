import { NextResponse } from "next/server";
import { isValidEbayItemId } from "@/lib/ebay-inventory";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { respondToQuestion } from "@/lib/ebay-messages";

export const runtime = "nodejs";

// eBay message/sender IDs aren't a fixed numeric shape like item IDs (a
// SenderID is an eBay username, a MessageID is an opaque token) -- guard
// against empty/oversized/garbage values instead of a strict format regex.
function isNonEmptyShortString(v: unknown, maxLen: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= maxLen;
}

const MAX_BODY_LEN = 2000; // eBay's own limit on AddMemberMessageRTQ's Body field.

interface RespondBody {
  messageId?: string;
  senderId?: string;
  itemId?: string;
  body?: string;
  displayToPublic?: boolean;
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  const connection = await requireEbayConnection(auth);
  if (!connection) {
    return NextResponse.json({ error: "eBay not connected.", connect: true }, { status: 502 });
  }

  let parsed: RespondBody;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { messageId, senderId, itemId, body, displayToPublic } = parsed;

  if (!isNonEmptyShortString(messageId, 200)) {
    return NextResponse.json({ error: "Invalid or missing messageId." }, { status: 400 });
  }
  if (!isNonEmptyShortString(senderId, 200)) {
    return NextResponse.json({ error: "Invalid or missing senderId." }, { status: 400 });
  }
  if (itemId != null && (typeof itemId !== "string" || !isValidEbayItemId(itemId))) {
    return NextResponse.json({ error: "Invalid itemId." }, { status: 400 });
  }
  if (!isNonEmptyShortString(body, MAX_BODY_LEN)) {
    return NextResponse.json({ error: `Reply must be between 1 and ${MAX_BODY_LEN} characters.` }, { status: 400 });
  }

  return ebayContext.run(connection, async () => {
    const result = await respondToQuestion({
      parentMessageId: messageId,
      recipientId: senderId,
      itemId: itemId ?? null,
      body,
      displayToPublic: displayToPublic === true,
    });

    if (!result.success) {
      console.error("POST /api/ebay/messages/respond: eBay rejected the reply:", result.error);
      return NextResponse.json({ error: result.error ?? "eBay rejected the reply." }, { status: 502 });
    }
    return NextResponse.json({ success: true });
  });
}
