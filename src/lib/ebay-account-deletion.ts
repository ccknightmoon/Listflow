// eBay Marketplace Account Deletion/Closure notifications (required by eBay
// for every app that stores eBay user data; without it eBay can switch off
// the production keyset). See https://developer.ebay.com/marketplace-account-deletion
//
//  GET  ?challenge_code=…  -> {"challengeResponse": sha256hex(code + token + endpoint)}
//  POST notification       -> verify the X-EBAY-SIGNATURE (ECDSA/SHA1, public
//                             key from the Notification API, cached 1 h), then
//                             delete that eBay user's data here.
//
// What Listflow stores per eBay user: the seller's eBay connection (encrypted
// refresh token, eBay user ID, policy IDs) plus eBay-derived history
// (sale_costs, active_listing_snapshots). Buyers' details are never stored
// (Ship/Messages read them live from eBay). The Listflow account itself and
// the seller's own drafts are Listflow data and are kept; the seller is
// simply disconnected from eBay.
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ebayHttps, getAppToken } from "@/lib/ebay-app-token";

export function challengeResponse(challengeCode: string, verificationToken: string, endpoint: string): string {
  return crypto.createHash("sha256").update(challengeCode).update(verificationToken).update(endpoint).digest("hex");
}

/** eBay's rule for the verification token: 32–80 chars, [A-Za-z0-9_-]. */
export function isValidVerificationToken(t: string | undefined): t is string {
  return typeof t === "string" && /^[A-Za-z0-9_-]{32,80}$/.test(t);
}

export interface SignatureHeader {
  alg?: string;
  kid: string;
  signature: string;
  digest?: string;
}

export function parseSignatureHeader(header: string | null): SignatureHeader | null {
  if (!header || header.length > 4096) return null;
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Partial<SignatureHeader>;
    if (typeof parsed.kid !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(parsed.kid)) return null;
    if (typeof parsed.signature !== "string" || !parsed.signature) return null;
    return parsed as SignatureHeader;
  } catch {
    return null;
  }
}

/** eBay returns the PEM on one line; Node needs the header/footer on their own lines. */
export function formatPublicKey(key: string): string {
  return key
    .replace(/^-----BEGIN PUBLIC KEY-----/, "-----BEGIN PUBLIC KEY-----\n")
    .replace(/-----END PUBLIC KEY-----$/, "\n-----END PUBLIC KEY-----");
}

/**
 * True when `signature` (base64, ECDSA over SHA-1) matches the payload. eBay's
 * own SDK signs JSON.stringify(parsed body); the raw body is tried first.
 */
export function verifyNotificationSignature(rawBody: string, parsedBody: unknown, sig: SignatureHeader, publicKeyPem: string): boolean {
  const key = formatPublicKey(publicKeyPem);
  const candidates = [rawBody, JSON.stringify(parsedBody)];
  for (const payload of candidates) {
    try {
      if (crypto.verify("sha1", Buffer.from(payload, "utf8"), key, Buffer.from(sig.signature, "base64"))) return true;
    } catch {
      // bad key / signature format -> not verified
    }
  }
  return false;
}

const keyCache = new Map<string, { key: string; expires: number }>();
const KEY_TTL_MS = 60 * 60_000;

/** Notification API getPublicKey, cached for an hour per key id (eBay's advice). */
export async function getNotificationPublicKey(kid: string): Promise<string> {
  const hit = keyCache.get(kid);
  if (hit && hit.expires > Date.now()) return hit.key;
  const token = await getAppToken();
  const { status, body } = await ebayHttps({
    hostname: "api.ebay.com",
    path: `/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`,
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (status !== 200) throw new Error(`getPublicKey ${status}`);
  const data = JSON.parse(body) as { key?: string };
  if (!data.key) throw new Error("getPublicKey: no key");
  keyCache.set(kid, { key: data.key, expires: Date.now() + KEY_TTL_MS });
  return data.key;
}

export interface DeletionData {
  username?: string;
  userId?: string;
  eiasToken?: string;
}

/** The notification's user identifiers, or null if it isn't a deletion notification. */
export function parseDeletionNotification(body: unknown): { notificationId: string; data: DeletionData } | null {
  const b = body as { metadata?: { topic?: unknown }; notification?: { notificationId?: unknown; data?: Record<string, unknown> } } | null;
  if (!b || b.metadata?.topic !== "MARKETPLACE_ACCOUNT_DELETION") return null;
  const d = b.notification?.data ?? {};
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 512 ? v : undefined);
  const data: DeletionData = { username: str(d.username), userId: str(d.userId), eiasToken: str(d.eiasToken) };
  if (!data.username && !data.userId && !data.eiasToken) return null;
  return { notificationId: str(b.notification?.notificationId) ?? "unknown", data };
}

/**
 * Deletes everything Listflow holds for this eBay user (see header). Matches
 * ebay_connections by eBay user ID (username or immutable ID) and, when
 * migration 032 is applied, by EIAS token. Returns how many Listflow
 * accounts were affected (normally 0 -- most notifications are for eBay
 * users who never used Listflow).
 */
export async function deleteEbayUserData(db: SupabaseClient, d: DeletionData): Promise<{ matched: number }> {
  const ids = [d.username, d.userId].filter((x): x is string => !!x);
  const owners = new Set<string>();
  if (ids.length) {
    const { data, error } = await db.from("ebay_connections").select("user_id").in("ebay_user_id", ids);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) owners.add(r.user_id as string);
  }
  if (d.eiasToken) {
    const { data, error } = await db.from("ebay_connections").select("user_id").eq("ebay_eias_token", d.eiasToken);
    // Before migration 032 the column doesn't exist: skip that match.
    if (!error) for (const r of data ?? []) owners.add(r.user_id as string);
  }
  for (const userId of owners) {
    // eBay-derived history first, then the connection itself (token + IDs).
    for (const table of ["sale_costs", "active_listing_snapshots"]) {
      const { error } = await db.from(table).delete().eq("user_id", userId);
      if (error && !/does not exist|schema cache/i.test(error.message)) throw new Error(`${table}: ${error.message}`);
    }
    const { error } = await db.from("ebay_connections").delete().eq("user_id", userId);
    if (error) throw new Error(`ebay_connections: ${error.message}`);
  }
  return { matched: owners.size };
}
