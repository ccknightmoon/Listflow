import crypto from "node:crypto";

// AES-256-GCM encryption for the one genuinely sensitive value in
// ebay_connections: each user's eBay refresh token. node:crypto is already
// a dependency-free pattern in this codebase (crypto.randomBytes is used
// in ebay-oauth.ts for OAuth state and in pwned-password.ts) — no new
// package needed.
//
// EBAY_TOKEN_ENCRYPTION_KEY must be a 32-byte key, base64-encoded. Generate
// it yourself and paste it directly into Vercel's env vars — it should
// never pass through chat or any tool call, same as this app's other
// secrets. Generate with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//
// Ciphertext is stored as one base64 blob: iv (12 bytes) || authTag (16
// bytes) || ciphertext, concatenated — simpler than separate columns and
// still lets decryption verify integrity (GCM's auth tag), not just
// decrypt blindly.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const b64 = process.env.EBAY_TOKEN_ENCRYPTION_KEY;
  if (!b64) {
    throw new Error(
      "EBAY_TOKEN_ENCRYPTION_KEY is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\" and add it to Vercel env vars."
    );
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error(`EBAY_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes, got ${key.length}.`);
  }
  return key;
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptToken(blob: string): string {
  const key = getKey();
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = buf.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf-8");
}
