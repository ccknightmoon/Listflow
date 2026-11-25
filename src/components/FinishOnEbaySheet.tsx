"use client";

import Sheet from "@/components/Sheet";
import { CalendarClock, Info } from "lucide-react";
import { DRAFTS_TAB_NOTE, FEE_NOTE, FINISH_STEPS } from "@/lib/finish-on-ebay";

// First-use explainer for "Finish on eBay" (afterwards a short confirm).
export default function FinishOnEbaySheet({ open, onClose, onConfirm, busy = false }: { open: boolean; onClose: () => void; onConfirm: () => void; busy?: boolean }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Finish on eBay"
      footer={
        <div className="flex gap-2">
          <button type="button" className="btn flex-1" onClick={onClose}>Not now</button>
          <button type="button" className="btn btn-primary flex-1" onClick={onConfirm} disabled={busy}>
            <CalendarClock className="w-4 h-4" /> Send to the eBay app
          </button>
        </div>
      }
    >
      <p className="text-sm mb-3">The easiest way to finish a listing in the eBay app:</p>
      <ol className="flex flex-col gap-2 mb-4 text-sm list-decimal pl-5">
        {FINISH_STEPS.map((s) => <li key={s}>{s}</li>)}
      </ol>
      <div className="card p-3 text-xs flex gap-2 mb-2" style={{ background: "var(--glass)" }}>
        <Info className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--accent)" }} />
        <p>{DRAFTS_TAB_NOTE}</p>
      </div>
      <p className="text-xs text-[var(--text-tertiary)]">{FEE_NOTE}</p>
    </Sheet>
  );
}
