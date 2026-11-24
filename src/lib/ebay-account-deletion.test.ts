import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  challengeResponse, isValidVerificationToken, parseSignatureHeader, formatPublicKey,
  verifyNotificationSignature, parseDeletionNotification, deleteEbayUserData,
} from "@/lib/ebay-account-deletion";
import { parseGetUser } from "@/lib/ebay-identity";

describe("challenge", () => {
  it("hashes code + token + endpoint in that order (eBay's spec)", () => {
    const expected = crypto.createHash("sha256").update("abc" + "t".repeat(32) + "https://x.test/e").digest("hex");
    expect(challengeResponse("abc", "t".repeat(32), "https://x.test/e")).toBe(expected);
  });
  it("checks the verification token rules", () => {
    expect(isValidVerificationToken("a".repeat(31))).toBe(false);
    expect(isValidVerificationToken("a_b-C".repeat(8))).toBe(true);
    expect(isValidVerificationToken("a".repeat(40) + "!")).toBe(false);
  });
});

describe("signature", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString().replace(/\n/g, "");
  const body = { metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" }, notification: { notificationId: "n1", data: { username: "seller1", userId: "U1", eiasToken: "E1" } } };
  const raw = JSON.stringify(body);
  const signature = crypto.sign("sha1", Buffer.from(raw), privateKey).toString("base64");
  const header = Buffer.from(JSON.stringify({ alg: "ECDSA", kid: "key-1", signature, digest: "SHA1" })).toString("base64");

  it("parses the header and verifies a genuine payload", () => {
    const sig = parseSignatureHeader(header);
    expect(sig?.kid).toBe("key-1");
    expect(formatPublicKey(pem)).toMatch(/^-----BEGIN PUBLIC KEY-----\n/);
    expect(verifyNotificationSignature(raw, body, sig!, pem)).toBe(true);
  });
  it("rejects a tampered payload or junk header", () => {
    const sig = parseSignatureHeader(header)!;
    const tampered = raw.replace("seller1", "seller2");
    expect(verifyNotificationSignature(tampered, JSON.parse(tampered), sig, pem)).toBe(false);
    expect(parseSignatureHeader("not-base64-json")).toBeNull();
    expect(parseSignatureHeader(null)).toBeNull();
  });
  it("reads the deletion notification", () => {
    expect(parseDeletionNotification(body)).toEqual({ notificationId: "n1", data: { username: "seller1", userId: "U1", eiasToken: "E1" } });
    expect(parseDeletionNotification({ metadata: { topic: "OTHER" } })).toBeNull();
  });
});

describe("deleteEbayUserData", () => {
  function fakeDb(rows: Array<{ user_id: string; ebay_user_id: string | null; ebay_eias_token?: string | null }>, hasEias = true) {
    const deleted: string[] = [];
    const db = {
      from(table: string) {
        return {
          select() {
            return {
              in(col: string, vals: string[]) {
                return Promise.resolve({ data: rows.filter((r) => vals.includes((r as Record<string, unknown>)[col] as string)), error: null });
              },
              eq(col: string, val: string) {
                if (!hasEias) return Promise.resolve({ data: null, error: { message: "column ebay_eias_token does not exist" } });
                return Promise.resolve({ data: rows.filter((r) => (r as Record<string, unknown>)[col] === val), error: null });
              },
            };
          },
          delete() {
            return { eq: (_c: string, v: string) => { deleted.push(`${table}:${v}`); return Promise.resolve({ error: null }); } };
          },
        };
      },
    };
    return { db: db as never, deleted };
  }

  it("deletes the matching seller's eBay data by username or EIAS token", async () => {
    const { db, deleted } = fakeDb([{ user_id: "a", ebay_user_id: "seller1" }, { user_id: "b", ebay_user_id: null, ebay_eias_token: "E9" }]);
    expect((await deleteEbayUserData(db, { username: "seller1", eiasToken: "E9" })).matched).toBe(2);
    expect(deleted).toEqual(expect.arrayContaining(["ebay_connections:a", "ebay_connections:b", "sale_costs:a", "active_listing_snapshots:b"]));
  });
  it("does nothing for eBay users who never used Listflow, and works before migration 032", async () => {
    const { db, deleted } = fakeDb([{ user_id: "a", ebay_user_id: "seller1" }], false);
    expect((await deleteEbayUserData(db, { username: "someone", eiasToken: "E1" })).matched).toBe(0);
    expect(deleted).toEqual([]);
  });
});

describe("parseGetUser", () => {
  it("reads the user ID and EIAS token", () => {
    const xml = "<GetUserResponse><Ack>Success</Ack><User><EIASToken>nY+abc==</EIASToken><UserID>sel&amp;co</UserID></User></GetUserResponse>";
    expect(parseGetUser(xml)).toEqual({ username: "sel&co", eiasToken: "nY+abc==" });
  });
});
