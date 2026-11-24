// Which eBay user a connection belongs to (Trading API GetUser, read-only,
// no extra OAuth scope). Stored on ebay_connections so an eBay Marketplace
// Account Deletion notification can be matched to the right seller
// (src/lib/ebay-account-deletion.ts). Server only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { tradingRequest } from "@/lib/ebay-inventory";
import { decodeEntities } from "@/lib/html-entities";

export interface EbayIdentity {
  username: string | null;
  eiasToken: string | null;
}

export function parseGetUser(xml: string): EbayIdentity {
  const user = /<User>([\s\S]*?)<\/User>/.exec(xml)?.[1] ?? "";
  const pick = (tag: string) => {
    const v = new RegExp(`<${tag}>([^<]{1,512})</${tag}>`).exec(user)?.[1];
    return v ? decodeEntities(v.trim()) : null;
  };
  return { username: pick("UserID"), eiasToken: pick("EIASToken") };
}

/** Must run inside ebayContext.run(connection, …). */
export async function fetchEbayIdentity(): Promise<EbayIdentity> {
  const { body } = await tradingRequest(
    "GetUser",
    `<?xml version="1.0" encoding="utf-8"?><GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents"><DetailLevel>ReturnSummary</DetailLevel></GetUserRequest>`
  );
  if (!body.includes("<Ack>Success</Ack>") && !body.includes("<Ack>Warning</Ack>")) throw new Error("GetUser failed");
  return parseGetUser(body);
}

/**
 * Saves the identity on the seller's own connection row. The EIAS token
 * column comes with migration 032; until then only the user ID is saved.
 */
export async function storeEbayIdentity(db: SupabaseClient, userId: string, id: EbayIdentity): Promise<void> {
  if (!id.username && !id.eiasToken) return;
  const full = await db.from("ebay_connections").update({ ebay_user_id: id.username, ebay_eias_token: id.eiasToken }).eq("user_id", userId);
  if (!full.error) return;
  if (/ebay_eias_token/.test(full.error.message)) {
    await db.from("ebay_connections").update({ ebay_user_id: id.username }).eq("user_id", userId);
  }
}
