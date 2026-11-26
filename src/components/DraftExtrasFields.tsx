"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { MAX_LOCATION_LENGTH, normalizeLocation } from "@/lib/storage-locations";

type Props = {
  draftId: string;
  /** null = column not in the database yet (migration 041) -> hidden. */
  bin: string | null | undefined;
  /** undefined = column not in the database yet (migration 042) -> hidden. */
  autoOfferOptIn: boolean | undefined;
  /** Settings → Storage & pick list is ON in "Bins / racks" mode (default false = no field). */
  showLocation?: boolean;
  /** "SKU boxes" mode: the box worked out from the SKU (read-only), else null/undefined. */
  derivedLocation?: string | null;
  disabled?: boolean;
};

/**
 * Storage location (only in "Bins / racks" mode) + "Include in automatic offers", saved on their own
 * (POST /api/drafts/extras) the moment they change, so they never touch the
 * main draft save. Hidden when the database doesn't have the columns yet.
 */
export default function DraftExtrasFields({ draftId, bin, autoOfferOptIn, showLocation = false, derivedLocation, disabled }: Props) {
  const hasBin = bin !== undefined && showLocation;
  const hasDerived = !!derivedLocation;
  const hasOptIn = autoOfferOptIn !== undefined;
  const [binText, setBinText] = useState(bin ?? "");
  const [savedBin, setSavedBin] = useState(bin ?? "");
  const [optIn, setOptIn] = useState(!!autoOfferOptIn);
  const [status, setStatus] = useState<string | null>(null);

  if (!hasBin && !hasOptIn && !hasDerived) return null;

  async function save(patch: Record<string, unknown>) {
    setStatus("Saving…");
    try {
      await apiFetch("/api/drafts/extras", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [draftId], ...patch }) });
      setStatus("Saved ✓");
      return true;
    } catch (e) {
      setStatus((e as Error).message || "Couldn't save");
      return false;
    }
  }

  async function saveBin() {
    const norm = normalizeLocation(binText);
    if (norm === undefined) { setStatus(`Storage location: up to ${MAX_LOCATION_LENGTH} characters`); return; }
    if ((norm ?? "") === savedBin) return;
    if (await save({ binLocation: norm })) { setSavedBin(norm ?? ""); setBinText(norm ?? ""); }
  }

  return (
    <div className="grid grid-cols-2 gap-3" data-testid="draft-extras">
      {hasDerived && (
        <div>
          <p className="text-xs text-[var(--text-secondary)] mb-1">Storage location</p>
          <p className="text-sm font-medium" data-testid="derived-location">{derivedLocation}</p>
          <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>From the SKU (Settings → Storage &amp; pick list)</p>
        </div>
      )}
      {hasBin && (
        <div>
          <label htmlFor={`bin-${draftId}`} className="text-xs text-[var(--text-secondary)] mb-1 block">Storage location</label>
          <input
            id={`bin-${draftId}`}
            className="input w-full uppercase"
            placeholder="e.g. RACK B"
            maxLength={MAX_LOCATION_LENGTH}
            value={binText}
            disabled={disabled}
            onChange={(e) => setBinText(e.target.value)}
            onBlur={() => void saveBin()}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
        </div>
      )}
      {hasOptIn && (
        <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)] pt-5 cursor-pointer">
          <input
            type="checkbox"
            checked={optIn}
            disabled={disabled}
            onChange={async (e) => {
              const v = e.target.checked;
              setOptIn(v);
              if (!(await save({ autoOfferOptIn: v }))) setOptIn(!v);
            }}
          />
          <span>Include in automatic offers to watchers <span className="block text-[10px]" style={{ color: "var(--text-tertiary)" }}>Only if turned on in Settings. Never below your floor or cost.</span></span>
        </label>
      )}
      {status && <p className="col-span-2 text-[11px]" style={{ color: "var(--text-tertiary)" }} role="status">{status}</p>}
    </div>
  );
}
