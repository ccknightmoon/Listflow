import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { TRADING_CALLS, KNOWN_DEPRECATED, callsNearShutdown } from "./ebay-api-inventory";

// Every Trading call the code sends: the XML request root (<XRequest xmlns=...>),
// tradingRequest("X", ...) and the publish path's TradingCall type.
function tradingCallsInSource(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) {
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(/tradingRequest\(\s*["'`]([A-Za-z]+)["'`]/g)) found.add(m[1]);
        for (const m of src.matchAll(/<([A-Za-z]+)Request xmlns="urn:ebay:apis/g)) found.add(m[1]);
        for (const t of src.matchAll(/type TradingCall = ([^;]+);/g)) for (const m of t[1].matchAll(/"([A-Za-z]+)"/g)) found.add(m[1]);
      }
    }
  };
  walk(path.resolve(__dirname, ".."));
  return found;
}

describe("eBay API deprecation watch", () => {
  const used = tradingCallsInSource();
  it("finds the calls (sanity)", () => {
    expect(used.has("AddFixedPriceItem")).toBe(true);
    expect(used.has("GetMyeBaySelling")).toBe(true);
  });
  it("every Trading call in the code is in the inventory", () => {
    for (const c of used) expect(TRADING_CALLS, `add ${c} to src/lib/ebay-api-inventory.ts`).toHaveProperty(c);
  });
  it("never uses a call eBay has deprecated or shut down", () => {
    for (const c of used) expect(KNOWN_DEPRECATED, c).not.toHaveProperty(c);
  });
  it("no call Listflow uses shuts down within 6 months", () => {
    expect(callsNearShutdown()).toEqual([]);
  });
});
