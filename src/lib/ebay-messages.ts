import { tradingRequest } from "@/lib/ebay-inventory";
import { xmlFind, xmlFindAll } from "@/lib/ebay-listings";
import { decodeEntities } from "@/lib/html-entities";

// Buyer questions come in through eBay's "Ask seller a question" flow on a
// listing. Confirmed against eBay's Trading API reference before writing
// this: GetMemberMessages needs MailMessageType=AskSellerQuestion plus
// either an ItemID or a creation-date range -- a date range is used here so
// this isn't scoped to one listing. MessageStatus=Unanswered narrows the
// result to just what actually needs a reply.
const QUESTION_WINDOW_DAYS = 30;

export interface BuyerQuestion {
  messageId: string;
  senderId: string;
  subject: string;
  body: string;
  createdAt: string;
  itemId: string | null;
  itemTitle?: string | null;
  itemPrice?: number | null;
}

// eBay returns 25 messages per page by default; ask for the max (200) and
// walk every page so a busy week doesn't silently hide questions.
const MESSAGES_PAGE_SIZE = 200;
const MESSAGES_MAX_PAGES = 10;

export function makeGetMemberMessagesXml(page = 1, now = new Date()): string {
  const start = new Date(now.getTime() - QUESTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return `<?xml version="1.0" encoding="utf-8"?><GetMemberMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><MailMessageType>AskSellerQuestion</MailMessageType><MessageStatus>Unanswered</MessageStatus><StartCreationTime>${start.toISOString()}</StartCreationTime><EndCreationTime>${now.toISOString()}</EndCreationTime><Pagination><EntriesPerPage>${MESSAGES_PAGE_SIZE}</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></GetMemberMessagesRequest>`;
}

/** TotalNumberOfPages from a paginated Trading response (1 if absent). */
export function parseTotalPages(body: string): number {
  const n = parseInt(xmlFind(xmlFind(body, "PaginationResult"), "TotalNumberOfPages") || "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// Single call covering every listing at once (unlike GetBestOffers, which
// is one call per active listing) -- no worker-pool/concurrency cap needed
// here.
/** Parse GetMemberMessages XML into questions with their listing details. */
export function parseMemberMessages(body: string): BuyerQuestion[] {
  // eBay nests each question in a <MemberMessageExchange>, with the listing
  // (<Item>) as a SIBLING of <Question> -- not inside it. Reading Item from
  // inside Question is why every card used to say "Your listing".
  const exchanges = xmlFindAll(body, "MemberMessageExchange");
  return (exchanges.length ? exchanges : xmlFindAll(body, "Question"))
    .map((ex) => {
      const q = xmlFind(ex, "Question") || ex;
      const itemBlock = xmlFind(ex, "Item");
      const priceStr = xmlFind(xmlFind(itemBlock, "SellingStatus"), "CurrentPrice");
      const price = priceStr ? parseFloat(priceStr) : NaN;
      return {
        messageId: xmlFind(q, "MessageID"),
        senderId: xmlFind(q, "SenderID"),
        subject: decodeEntities(xmlFind(q, "Subject")),
        body: decodeEntities(xmlFind(q, "Body")),
        createdAt: xmlFind(q, "CreationDate"),
        itemId: xmlFind(itemBlock, "ItemID") || null,
        itemTitle: decodeEntities(xmlFind(itemBlock, "Title")) || null,
        itemPrice: Number.isFinite(price) ? price : null,
      };
    })
    .filter((q) => q.messageId && q.senderId);

}

export async function fetchUnansweredQuestions(): Promise<{ questions: BuyerQuestion[]; error?: string; reconnect?: boolean }> {
  const now = new Date();
  const { body } = await tradingRequest("GetMemberMessages", makeGetMemberMessagesXml(1, now));

  if (!body.includes("<Ack>Success</Ack>") && !body.includes("<Ack>Warning</Ack>")) {
    const errMsg = xmlFind(body, "LongMessage") || xmlFind(body, "ShortMessage") || "Couldn't load buyer questions.";
    // Same auth/scope classification as /api/ebay/sales -- this page had
    // no reconnect detection at all before, unlike every other eBay page,
    // so a routine expired-token error here showed a dead-end "try
    // refreshing" instead of the reconnect prompt every sibling page shows.
    const isAuth = errMsg.toLowerCase().includes("auth") || errMsg.toLowerCase().includes("token") || errMsg.toLowerCase().includes("permission") || errMsg.toLowerCase().includes("scope");
    return { questions: [], error: errMsg, reconnect: isAuth };
  }

  const questions = parseMemberMessages(body);
  const pages = Math.min(parseTotalPages(body), MESSAGES_MAX_PAGES);
  for (let page = 2; page <= pages; page++) {
    const next = await tradingRequest("GetMemberMessages", makeGetMemberMessagesXml(page, now));
    if (!next.body.includes("<Ack>Success</Ack>") && !next.body.includes("<Ack>Warning</Ack>")) break;
    questions.push(...parseMemberMessages(next.body));
  }
  const seen = new Set<string>();
  return { questions: questions.filter((q) => (seen.has(q.messageId) ? false : (seen.add(q.messageId), true))) };
}

interface RespondToQuestionArgs {
  parentMessageId: string;
  recipientId: string;
  itemId: string | null;
  body: string;
  displayToPublic: boolean;
}

// AddMemberMessageRTQ ("respond to question") -- confirmed required fields:
// Body (<=2000 chars, no HTML), ParentMessageID (the question's MessageID),
// RecipientID (the buyer's eBay user ID -- the question's SenderID). ItemID
// is optional. DisplayToPublic defaults to false here rather than trusting
// eBay's own default (not confirmed either way) -- a casual reseller likely
// doesn't expect a reply to post publicly on the listing unless they choose
// that.
export async function respondToQuestion(args: RespondToQuestionArgs): Promise<{ success: boolean; error?: string }> {
  const itemFields = args.itemId ? `<ItemID>${args.itemId}</ItemID>` : "";
  const xml = `<?xml version="1.0" encoding="utf-8"?><AddMemberMessageRTQRequest xmlns="urn:ebay:apis:eBLBaseComponents">${itemFields}<MemberMessage><Body>${escapeXml(args.body)}</Body><ParentMessageID>${args.parentMessageId}</ParentMessageID><RecipientID>${args.recipientId}</RecipientID><DisplayToPublic>${args.displayToPublic ? "true" : "false"}</DisplayToPublic></MemberMessage></AddMemberMessageRTQRequest>`;

  try {
    const { body: respBody } = await tradingRequest("AddMemberMessageRTQ", xml);
    if (respBody.includes("<Ack>Success</Ack>") || respBody.includes("<Ack>Warning</Ack>")) {
      return { success: true };
    }
    const errMsg = xmlFind(respBody, "LongMessage") || xmlFind(respBody, "ShortMessage") || "eBay rejected the reply.";
    return { success: false, error: errMsg };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
