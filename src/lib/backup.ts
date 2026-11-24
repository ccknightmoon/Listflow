// Weekly backup of Listflow's key tables (Security 4c). Server only.
//
// Free-plan friendly: no new cron. The existing daily snapshot cron calls
// maybeRunWeeklyBackup() at the end; it runs when the newest backup is older
// than ~6.5 days. Output: one gzipped JSON file per run in a private storage
// bucket `backups` (created on first run, service role only; the newest 8
// are kept), plus an emailed copy when BACKUP_EMAIL_TO is set (off-site:
// survives losing the Supabase project).
//
// Not a replacement for Supabase Pro's daily backups / point-in-time
// recovery -- a safety net until then. Tokens stay encrypted (the encrypted
// eBay refresh token is copied as-is; useless without EBAY_TOKEN_ENCRYPTION_KEY).
import { gzipSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";

export const BACKUP_BUCKET = "backups";
export const BACKUP_TABLES = ["drafts", "app_settings", "ebay_connections", "sale_costs", "active_listing_snapshots", "ai_usage_counters"] as const;
const KEEP = 8;
const MIN_GAP_MS = 6.5 * 86_400_000;
const PAGE = 1000;
const MAX_ROWS_PER_TABLE = 200_000;

export interface BackupResult {
  ran: boolean;
  reason?: string;
  file?: string;
  rows?: Record<string, number>;
  bytes?: number;
  emailed?: boolean;
  errors?: string[];
}

export function backupFileName(now: Date): string {
  return `listflow-backup-${now.toISOString().slice(0, 19).replace(/:/g, "-")}Z.json.gz`;
}

/** Newest backup time from file names like listflow-backup-2026-11-24T07-30-00Z.json.gz. */
export function newestBackupMs(names: string[]): number | null {
  let best: number | null = null;
  for (const n of names) {
    const m = /^listflow-backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.json\.gz$/.exec(n);
    if (!m) continue;
    const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
    if (Number.isFinite(t) && (best == null || t > best)) best = t;
  }
  return best;
}

/** Files to delete so only the newest `keep` backups remain. */
export function backupsToPrune(names: string[], keep = KEEP): string[] {
  const ours = names.filter((n) => newestBackupMs([n]) != null).sort();
  return ours.slice(0, Math.max(0, ours.length - keep));
}

async function dumpTable(db: SupabaseClient, table: string): Promise<{ rows: unknown[]; error?: string }> {
  const rows: unknown[] = [];
  for (let from = 0; from < MAX_ROWS_PER_TABLE; from += PAGE) {
    const { data, error } = await db.from(table).select("*").range(from, from + PAGE - 1);
    if (error) return { rows, error: `${table}: ${error.message}` };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return { rows };
}

export async function maybeRunWeeklyBackup(
  db: SupabaseClient,
  opts: { force?: boolean; now?: () => number; email?: (file: string, gz: Buffer, summary: string) => Promise<boolean> } = {}
): Promise<BackupResult> {
  const now = (opts.now ?? Date.now)();
  // Bucket on first run (private; only the service role can read it).
  const { error: bErr } = await db.storage.getBucket(BACKUP_BUCKET);
  if (bErr) {
    const { error: cErr } = await db.storage.createBucket(BACKUP_BUCKET, { public: false });
    if (cErr && !/exists/i.test(cErr.message)) return { ran: false, reason: `Couldn't create the backups bucket: ${cErr.message}` };
  }
  const { data: files, error: lErr } = await db.storage.from(BACKUP_BUCKET).list("", { limit: 1000 });
  if (lErr) return { ran: false, reason: lErr.message };
  const names = (files ?? []).map((f) => f.name);
  const newest = newestBackupMs(names);
  if (!opts.force && newest != null && now - newest < MIN_GAP_MS) return { ran: false, reason: "not due yet" };

  const tables: Record<string, unknown[]> = {};
  const rows: Record<string, number> = {};
  const errors: string[] = [];
  for (const t of BACKUP_TABLES) {
    const r = await dumpTable(db, t);
    tables[t] = r.rows;
    rows[t] = r.rows.length;
    if (r.error) errors.push(r.error);
  }
  const file = backupFileName(new Date(now));
  const gz = gzipSync(Buffer.from(JSON.stringify({ createdAt: new Date(now).toISOString(), version: 1, tables })));
  const { error: upErr } = await db.storage.from(BACKUP_BUCKET).upload(file, gz, { contentType: "application/gzip", upsert: false });
  if (upErr) return { ran: false, reason: `Upload failed: ${upErr.message}`, errors };

  const prune = backupsToPrune([...names, file]);
  if (prune.length) await db.storage.from(BACKUP_BUCKET).remove(prune);

  const summary = Object.entries(rows).map(([t, n]) => `${t}: ${n} rows`).join("\n") + (errors.length ? `\nProblems: ${errors.join("; ")}` : "");
  const emailed = opts.email ? await opts.email(file, gz, summary).catch(() => false) : false;
  return { ran: true, file, rows, bytes: gz.length, emailed, errors: errors.length ? errors : undefined };
}
