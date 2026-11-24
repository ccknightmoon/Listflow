import { describe, it, expect } from "vitest";
import { verifiedUser } from "@/lib/verified-user";

const client = (r: unknown) => ({ auth: { getClaims: async () => r as never } });

describe("verifiedUser", () => {
  it("returns the user from verified claims", async () => {
    expect(await verifiedUser(client({ data: { claims: { sub: "u1", email: "a@b.c" } }, error: null }))).toEqual({ id: "u1", email: "a@b.c" });
  });
  it("is null without a session, on errors, or when it throws", async () => {
    expect(await verifiedUser(client({ data: null, error: null }))).toBeNull();
    expect(await verifiedUser(client({ data: { claims: { sub: "u1" } }, error: new Error("bad sig") }))).toBeNull();
    expect(await verifiedUser({ auth: { getClaims: async () => { throw new Error("x"); } } })).toBeNull();
  });
});
