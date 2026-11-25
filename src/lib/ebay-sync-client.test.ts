import { describe, it, expect } from "vitest";
import { syncedAgo, shouldSync, SYNC_EVERY_MS } from "./ebay-sync-client";

describe("sync indicator text", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  it("reads like a person would say it", () => {
    expect(syncedAgo(null, now)).toBeNull();
    expect(syncedAgo("2026-11-25T11:59:40Z", now)).toBe("just now");
    expect(syncedAgo("2026-11-25T11:57:00Z", now)).toBe("3 min ago");
    expect(syncedAgo("2026-11-25T09:00:00Z", now)).toBe("3 h ago");
    expect(syncedAgo("2026-11-24T11:00:00Z", now)).toBe("1 day ago");
  });
  it("syncs every 5 minutes", () => {
    expect(SYNC_EVERY_MS).toBe(300_000);
    expect(shouldSync(null, now)).toBe(true);
    expect(shouldSync("2026-11-25T11:58:00Z", now)).toBe(false);
    expect(shouldSync("2026-11-25T11:54:00Z", now)).toBe(true);
  });
});
