"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { MAX_BIN_LENGTH, normalizeBin } from "@/lib/bins";

type Props = {
  draftId: string;
  /** null = column not in the database yet (migration 041) -> hidden. */
  bin: string | null | undefined;
  /** undefined = column not in the database yet (migration 042) -> hidden. */
  autoOfferOptIn: boolean | undefined;
  disabled?: boolean;
};

/**
 * Bin location + "Include in automatic offers", saved on their own
 * (POST /api/drafts/extras) the moment they change, so they never touch the
 * main draft save. Hidden when the database doesn't have the columns yet.
 */
export default function DraftExtrasFields({ draftId, bin, autoOfferOptIn, disabled }: Props) {
  const hasBin = bin !== undefined;
  const hasOptIn = autoOfferOptIn !== undefined;
  const [binText, setBinText] = useState(bin ?? "");
  const [savedBin, setSavedBin] = useState(bin ?? "");
  const [optIn, setOptIn] = useState(!!autoOfferOptIn);
  const [status, setStatus] = useState<string | null>(null);

  if (!hasBin && !hasOptIn) return null;

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
    const norm = normalizeBin(binText);
    if (norm === undefined) { setStatus(`Bin: up to ${MAX_BIN_LENGTH} characters`); return; }
    if ((norm ?? "") === savedBin) return;
    if (await save({ binLocation: norm })) { setSavedBin(norm ?? ""); setBinText(norm ?? ""); }
  }

  return (
    <div className="grid grid-cols-2 gap-3" data-testid="draft-extras">
      {hasBin && (
        <div>
          <label htmlFor={`bin-${draftId}`} className="text-xs text-[var(--text-secondary)] mb-1 block">Bin / shelf</label>
          <input
            id={`bin-${draftId}`}
            className="input w-full uppercase"
            placeholder="e.g. B3"
            maxLength={MAX_BIN_LENGTH}
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
