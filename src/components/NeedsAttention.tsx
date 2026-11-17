"use client";

import Link from "next/link";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { allCaughtUp, attentionItems, type AttentionCounts } from "@/lib/attention";

// One inbox for everything waiting on Sel, most urgent first. Rows only
// appear when there's something to do; each is one tap to the fix.
export default function NeedsAttention({ counts }: { counts: AttentionCounts }) {
  const items = attentionItems(counts);
  const caughtUp = allCaughtUp(counts);
  const tone = { danger: "var(--danger)", accent: "var(--accent)", warning: "var(--warning-border)" } as const;

  return (
    <div className="card d6 stagger col-span-2 p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-bold">Needs attention</p>
        {items.length > 0 && (
          <span className="text-[11px] font-semibold" style={{ color: "var(--text-tertiary)" }}>
            {items.reduce((a, i) => a + i.count, 0)} to do
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-xs flex items-center gap-1.5 py-2" style={{ color: caughtUp ? "var(--success)" : "var(--text-tertiary)" }}>
          {caughtUp ? <><CheckCircle2 className="w-4 h-4" /> All caught up — go list something.</> : "Checking eBay…"}
        </p>
      ) : (
        <div className="flex flex-col">
          {items.map((it, idx) => {
            const row = (
              <>
                <span className="w-2 h-2 rounded-full flex-none" style={{ background: tone[it.tone] }} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold">{it.label}</span>
                  <span className="block text-[11.5px] truncate" style={{ color: "var(--text-tertiary)" }}>{it.detail}</span>
                </span>
                <span className="text-[11px] font-extrabold min-w-[22px] h-[22px] rounded-full flex items-center justify-center px-1.5 text-white" style={{ background: tone[it.tone] }}>
                  {it.count}
                </span>
                <ChevronRight className="w-4 h-4 flex-none" style={{ color: "var(--text-tertiary)" }} />
              </>
            );
            const cls = "flex items-center gap-3 min-h-[52px] py-1.5";
            const style = idx > 0 ? { borderTop: "1px solid var(--border)" } : undefined;
            return it.href.startsWith("#") ? (
              <div key={it.key} className={cls} style={style}>{row}</div>
            ) : (
              <Link key={it.key} href={it.href} className={`${cls} tap`} style={style}>{row}</Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
