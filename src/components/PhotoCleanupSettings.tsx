"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

interface State {
  available: boolean;
  enabled: boolean;
  days: number;
  orphans: boolean;
  lastRun: string | null;
}

/** Settings → Photo storage. Hidden detail until migration 030 is applied. */
export default function PhotoCleanupSettings() {
  const [s, setS] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ orphans: { files: number; mb: number; error?: string }; legacy: { files: number; mb: number; error?: string } | null } | null>(null);
  const [checking, setChecking] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  async function check() {
    setChecking(true);
    setRunMsg(null);
    try {
      const r = await fetch("/api/settings/photo-cleanup?preview=1");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't check");
      setPreview(d.preview);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  async function runNow() {
    setChecking(true);
    try {
      const r = await fetch("/api/settings/photo-cleanup", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Cleanup failed");
      const rep = d.report ?? {};
      setRunMsg(rep.skippedReason ? `Nothing done: ${rep.skippedReason}.` : `Done: ${rep.photosDeleted ?? 0} listed-item photos, ${rep.orphansDeleted ?? 0} unused, ${rep.legacyDeleted ?? 0} old shared-folder photos deleted.`);
      setPreview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    fetch("/api/settings/photo-cleanup")
      .then((r) => r.json())
      .then((d) => setS(d.available ? d : { available: false, enabled: true, days: 3, orphans: false, lastRun: null }))
      .catch(() => setS(null));
  }, []);

  async function save(patch: Partial<State>) {
    if (!s) return;
    const prev = s;
    setS({ ...s, ...patch });
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/photo-cleanup", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't save");
    } catch (e) {
      setS(prev);
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!s) return <Loader2 className="w-4 h-4 animate-spin" />;
  if (!s.available) {
    return <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Not switched on yet (database update 030 pending). Nothing is deleted until it is.</p>;
  }
  return (
    <div className="flex flex-col gap-3 text-sm">
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1" checked={s.enabled} onChange={(e) => void save({ enabled: e.target.checked })} />
        <span>
          Delete our copies of photos{" "}
          <input
            type="number"
            min={1}
            max={90}
            inputMode="numeric"
            aria-label="Days after listing"
            className="input w-16 px-2 py-1 text-sm inline-block"
            value={s.days}
            disabled={!s.enabled}
            onChange={(e) => setS({ ...s, days: Number(e.target.value) })}
            onBlur={() => s.days >= 1 && s.days <= 90 && void save({ days: s.days })}
          />{" "}
          days after an item is listed on eBay
          <span className="block text-xs" style={{ color: "var(--text-secondary)" }}>
            eBay keeps its own copies; the draft switches to them first. Photos of drafts that aren&apos;t listed are never deleted.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1" checked={s.orphans} onChange={(e) => void save({ orphans: e.target.checked })} />
        <span>
          Also delete unused photos older than 7 days
          <span className="block text-xs" style={{ color: "var(--text-secondary)" }}>
            Left over from deleted drafts or batches that were never saved. Off by default.
          </span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn text-xs py-1.5 px-2.5" disabled={checking} onClick={() => void check()}>
          {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Check storage (deletes nothing)
        </button>
        {preview && (
          <button type="button" className="btn text-xs py-1.5 px-2.5" disabled={checking || !s.orphans} onClick={() => void runNow()} title={s.orphans ? "" : "Turn on 'Also delete unused photos' first"}>
            Clean up now
          </button>
        )}
      </div>
      {preview && (
        <p className="text-xs" data-testid="cleanup-preview" style={{ color: "var(--text-secondary)" }}>
          Unused photos older than 7 days: {preview.orphans.files} ({preview.orphans.mb} MB){preview.orphans.error ? ` — ${preview.orphans.error}` : ""}.
          {preview.legacy ? ` Old shared-folder photos nothing uses (30+ days): ${preview.legacy.files} (${preview.legacy.mb} MB)${preview.legacy.error ? ` — ${preview.legacy.error}` : ""}.` : ""}
          {!s.orphans ? " Turn on “Also delete unused photos” to remove them." : ""}
        </p>
      )}
      {runMsg && <p className="text-xs" role="status">{runMsg}</p>}
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        Runs once a day when you open the app.{s.lastRun ? ` Last run ${new Date(s.lastRun).toLocaleString()}.` : ""}
        {saving ? " Saving…" : ""}
      </p>
      {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}
