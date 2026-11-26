import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// Fake eBay token endpoint: records each refresh's scope and answers per `respond`.
const calls: string[] = [];
let respond: (scope: string) => object = () => ({ access_token: "tok", expires_in: 7200 });
vi.mock("node:https", () => ({
  default: {
    request: (_opts: unknown, cb: (res: EventEmitter) => void) => {
      const req = new EventEmitter() as EventEmitter & { write: (b: Buffer) => void; end: () => void };
      let body = "";
      req.write = (b: Buffer) => { body += b.toString(); };
      req.end = () => {
        const scope = new URLSearchParams(body).get("scope") ?? "";
        calls.push(scope);
        const res = new EventEmitter();
        cb(res);
        res.emit("data", Buffer.from(JSON.stringify(respond(scope))));
        res.emit("end");
      };
      return req;
    },
  },
}));

import { EBAY_EXTENDED_SCOPES, EBAY_EXTRA_SCOPES, EBAY_SCOPES, getAccessToken, hasScope, missingExtraScopes, scopesForRefresh } from "./ebay-oauth";
import { ebayContext } from "./ebay-request-context";

const ctx = (userId: string, grantedScopes?: string | null) => ({ userId, ebayUserId: null, refreshToken: "r", grantedScopes, policies: {} });

beforeEach(() => { calls.length = 0; respond = () => ({ access_token: "tok", expires_in: 7200 }); });

describe("scopes", () => {
  it("existing connections (no record) refresh with the original 5 scopes, unchanged", () => {
    expect(scopesForRefresh(null)).toBe(EBAY_SCOPES);
    expect(scopesForRefresh(undefined)).toBe(EBAY_SCOPES);
    expect(EBAY_SCOPES.split(" ")).toHaveLength(5);
    expect(EBAY_SCOPES).not.toContain("sell.marketing");
  });
  it("granted extended scopes are used; unknown or broken records fall back to base", () => {
    expect(scopesForRefresh(EBAY_EXTENDED_SCOPES)).toBe(EBAY_EXTENDED_SCOPES);
    expect(scopesForRefresh(`${EBAY_EXTENDED_SCOPES} https://evil/scope`)).toBe(EBAY_EXTENDED_SCOPES);
    expect(scopesForRefresh(EBAY_EXTRA_SCOPES.marketing)).toBe(EBAY_SCOPES); // base missing
  });
  it("hasScope / missingExtraScopes", () => {
    expect(hasScope(null, EBAY_EXTRA_SCOPES.marketing)).toBe(false);
    expect(missingExtraScopes(null)).toEqual(["marketing", "analytics", "fulfillment"]);
    expect(missingExtraScopes(EBAY_EXTENDED_SCOPES)).toEqual([]);
  });
});

describe("getAccessToken", () => {
  it("asks only for granted scopes", async () => {
    await ebayContext.run(ctx("u-base", null), () => getAccessToken());
    expect(calls).toEqual([EBAY_SCOPES]);
  });
  it("falls back to the base scopes if the extended refresh is refused", async () => {
    respond = (scope) => (scope === EBAY_SCOPES ? { access_token: "ok", expires_in: 7200 } : { error: "invalid_scope", error_description: "bad scope" });
    const t = await ebayContext.run(ctx("u-ext", EBAY_EXTENDED_SCOPES), () => getAccessToken());
    expect(t).toBe("ok");
    expect(calls).toEqual([EBAY_EXTENDED_SCOPES, EBAY_SCOPES]);
  });
  it("still throws when even the base refresh fails", async () => {
    respond = () => ({ error: "invalid_grant", error_description: "revoked" });
    await expect(ebayContext.run(ctx("u-dead", null), () => getAccessToken())).rejects.toThrow("revoked");
    expect(calls).toEqual([EBAY_SCOPES]);
  });
});
