import { describe, it, expect } from "vitest";
import { gunzipSync } from "node:zlib";
import { backupFileName, newestBackupMs, backupsToPrune, maybeRunWeeklyBackup } from "@/lib/backup";

describe("backup naming", () => {
  it("round-trips the time in the file name", () => {
    const t = Date.parse("2026-11-24T07:30:05Z");
    expect(newestBackupMs([backupFileName(new Date(t)), "other.txt"])).toBe(t);
  });
  it("keeps the newest 8", () => {
    const names = Array.from({ length: 10 }, (_, i) => backupFileName(new Date(Date.UTC(2026, 0, 1 + i * 7))));
    expect(backupsToPrune(names)).toEqual(names.slice(0, 2));
  });
});

describe("maybeRunWeeklyBackup", () => {
  function fakeDb(existing: string[]) {
    const uploads: Array<{ name: string; body: Buffer }> = [];
    const removed: string[] = [];
    const tables: Record<string, unknown[]> = { drafts: [{ id: 1 }, { id: 2 }], app_settings: [{ user_id: "u" }] };
    const db = {
      storage: {
        getBucket: async () => ({ error: null }),
        createBucket: async () => ({ error: null }),
        from: () => ({
          list: async () => ({ data: existing.map((name) => ({ name })), error: null }),
          upload: async (name: string, body: Buffer) => { uploads.push({ name, body }); return { error: null }; },
          remove: async (p: string[]) => { removed.push(...p); return { error: null }; },
        }),
      },
      from: (t: string) => ({ select: () => ({ range: async () => ({ data: tables[t] ?? [], error: null }) }) }),
    };
    return { db: db as never, uploads, removed };
  }

  it("skips when a backup is less than a week old", async () => {
    const now = Date.parse("2026-11-24T08:00:00Z");
    const { db, uploads } = fakeDb([backupFileName(new Date(now - 2 * 86_400_000))]);
    expect((await maybeRunWeeklyBackup(db, { now: () => now })).ran).toBe(false);
    expect(uploads).toHaveLength(0);
  });

  it("dumps the tables to a gzipped file when due", async () => {
    const now = Date.parse("2026-11-24T08:00:00Z");
    const { db, uploads } = fakeDb([backupFileName(new Date(now - 8 * 86_400_000))]);
    const r = await maybeRunWeeklyBackup(db, { now: () => now });
    expect(r.ran).toBe(true);
    expect(r.rows?.drafts).toBe(2);
    const json = JSON.parse(gunzipSync(uploads[0].body).toString());
    expect(json.tables.app_settings).toEqual([{ user_id: "u" }]);
  });
});
