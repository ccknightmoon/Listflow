import { NextResponse } from "next/server";
import { tradingRequest, isValidEbayItemId } from "@/lib/ebay-inventory";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { xmlFind } from "@/lib/ebay-listings";

export const runtime = "nodejs";

// eBay Best Offer IDs are the same numeric-identifier shape as item IDs --
// reusing the same digit-only guard isValidEbayItemId already applies to
// ItemID, both to stop XML injection and because a non-numeric "offer id"
// can't be a real one.
const BEST_OFFER_ID_RE = /^\d{6,20}$/;
function isValidBestOfferId(id: string): boolean {
  return BEST_OFFER_ID_RE.test(id);
}

type RespondAction = "accept" | "decline" | "counter";

function isValidAction(a: unknown): a is RespondAction {
  return a === "accept" || a === "decline" || a === "counter";
}

// eBay's own Action enum values (BestOfferActionCodeType) -- verified
// against eBay's Trading API reference. Note it's "Decline", not "Deny".
const EBAY_ACTION: Record<RespondAction, string> = {
  accept: "Accept",
  decline: "Decline",
  counter: "Counter",
};

interface RespondBody {
  itemId?: string;
  bestOfferId?: string;
  action?: string;
  counterPrice?: number;
  quantity?: number;
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  const connection = await requireEbayConnection(auth);
  if (!connection) {
    return NextResponse.json({ error: "eBay not connected.", connect: true }, { status: 502 });
  }

  let body: RespondBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { itemId, bestOfferId, action, counterPrice, quantity } = body;

  if (typeof itemId !== "string" || !isValidEbayItemId(itemId)) {
    return NextResponse.json({ error: "Invalid or missing itemId." }, { status: 400 });
  }
  if (typeof bestOfferId !== "string" || !isValidBestOfferId(bestOfferId)) {
    return NextResponse.json({ error: "Invalid or missing bestOfferId." }, { status: 400 });
  }
  if (!isValidAction(action)) {
    return NextResponse.json({ error: "action must be 'accept', 'decline', or 'counter'." }, { status: 400 });
  }
  if (action === "counter" && (typeof counterPrice !== "number" || !Number.isFinite(counterPrice) || counterPrice <= 0)) {
    return NextResponse.json({ error: "counterPrice must be a positive number for a counter offer." }, { status: 400 });
  }
  // Preserves the quantity the buyer actually offered on unless a caller
  // explicitly overrides it -- this app's listings are effectively always
  // qty=1 secondhand items, so 1 is also the safe default when unset.
  const counterQty = typeof quantity === "number" && Number.isFinite(quantity) && quantity >= 1 ? Math.floor(quantity) : 1;

  return ebayContext.run(connection, async () => {
    try {
      const counterFields =
        action === "counter"
          ? `<CounterOfferPrice>${(counterPrice as number).toFixed(2)}</CounterOfferPrice><CounterOfferQuantity>${counterQty}</CounterOfferQuantity>`
          : "";
      const xml = `<?xml version="1.0" encoding="utf-8"?><RespondToBestOfferRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${itemId}</ItemID><BestOfferID>${bestOfferId}</BestOfferID><Action>${EBAY_ACTION[action]}</Action>${counterFields}</RespondToBestOfferRequest>`;

      const { body: respBody } = await tradingRequest("RespondToBestOffer", xml);

      if (respBody.includes("<Ack>Success</Ack>") || respBody.includes("<Ack>Warning</Ack>")) {
        return NextResponse.json({ success: true });
      }

      const errMsg = xmlFind(respBody, "LongMessage") || xmlFind(respBody, "ShortMessage") || "eBay rejected the request.";
      return NextResponse.json({ error: errMsg }, { status: 502 });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
