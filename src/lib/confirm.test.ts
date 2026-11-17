import { describe, it, expect } from "vitest";
import { confirmAction, registerConfirmHost } from "./confirm";

describe("confirmAction", () => {
  it("routes to the styled host when mounted", async () => {
    const seen: string[] = [];
    registerConfirmHost(async (o) => { seen.push(o.title); return true; });
    expect(await confirmAction({ title: "End this listing?", destructive: true })).toBe(true);
    expect(seen).toEqual(["End this listing?"]);
    registerConfirmHost(null);
  });
  it("safely says no when nothing can ask (server/tests)", async () => {
    expect(await confirmAction({ title: "x" })).toBe(false);
  });
});
