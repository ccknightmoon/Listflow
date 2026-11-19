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
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        Runs once a day when you open the app.{s.lastRun ? ` Last run ${new Date(s.lastRun).toLocaleString()}.` : ""}
        {saving ? " Saving…" : ""}
      </p>
      {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}
