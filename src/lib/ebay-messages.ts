import { tradingRequest } from "@/lib/ebay-inventory";
import { xmlFind } from "@/lib/ebay-listings";

// Buyer questions come in through eBay's "Ask seller a question" flow on a
// listing. Confirmed against eBay's Trading API reference before writing
// this: GetMemberMessages needs MailMessageType=AskSellerQuestion plus
// either an ItemID or a creation-date range -- a date range is used here so
// this isn't scoped to one listing. MessageStatus=Unanswered narrows the
// result to just what actually needs a reply.
const QUESTION_WINDOW_DAYS = 30;

function xmlFindAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const results: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1]);
  return results;
}

export interface BuyerQuestion {
  messageId: string;
  senderId: string;
  subject: string;
  body: string;
  createdAt: string;
  itemId: string | null;
}

function makeGetMemberMessagesXml(): string {
  const now = new Date();
  const start = new Date(now.getTime() - QUESTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return `<?xml version="1.0" encoding="utf-8"?><GetMemberMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><MailMessageType>AskSellerQuestion</MailMessageType><MessageStatus>Unanswered</MessageStatus><StartCreationTime>${start.toISOString()}</StartCreationTime><EndCreationTime>${now.toISOString()}</EndCreationTime></GetMemberMessagesRequest>`;
}

// Single call covering every listing at once (unlike GetBestOffers, which
// is one call per active listing) -- no worker-pool/concurrency cap needed
// here.
export async function fetchUnansweredQuestions(): Promise<{ questions: BuyerQuestion[]; error?: string }> {
  const { body } = await tradingRequest("GetMemberMessages", makeGetMemberMessagesXml());

  if (!body.includes("<Ack>Success</Ack>") && !body.includes("<Ack>Warning</Ack>")) {
    const errMsg = xmlFind(body, "LongMessage") || xmlFind(body, "ShortMessage") || "Couldn't load buyer questions.";
    return { questions: [], error: errMsg };
  }

  const questions = xmlFindAll(body, "Question")
    .map((block) => {
      const itemBlock = xmlFind(block, "Item");
      return {
        messageId: xmlFind(block, "MessageID"),
        senderId: xmlFind(block, "SenderID"),
        subject: xmlFind(block, "Subject"),
        body: xmlFind(block, "Body"),
        createdAt: xmlFind(block, "CreationDate"),
        itemId: xmlFind(itemBlock, "ItemID") || null,
      };
    })
    .filter((q) => q.messageId && q.senderId);

  return { questions };
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
