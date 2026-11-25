"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { INVENTORY_STATUSES, STATUS_LABELS, STATUS_HINTS, inventoryHref, type InventoryStatus } from "@/lib/inventory-status";

// Title + status filters shared by every Inventory view. `extra` sits
// under the title (sync indicator, alerts).
export default function InventoryHeader({ status, extra }: { status: InventoryStatus; extra?: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-3 mb-3">
        <Link
          href="/dashboard"
          aria-label="Back to Home"
          className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center flex-none lg:hidden"
          style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-medium">Inventory</h1>
          <p className="text-xs text-[var(--text-secondary)]">{STATUS_HINTS[status]}</p>
        </div>
      </div>
      {extra}
      <nav aria-label="Status" className="flex gap-1 p-1 rounded-xl overflow-x-auto lg:max-w-xl" style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}>
        {INVENTORY_STATUSES.map((s) => {
          const on = s === status;
          return (
            <Link
              key={s}
              href={inventoryHref(s)}
              replace
              scroll={false}
              aria-current={on ? "page" : undefined}
              className="flex-1 min-w-[72px] text-center text-sm py-1.5 rounded-lg transition-colors"
              style={on ? { background: "var(--bg-surface)", color: "var(--text-primary)", fontWeight: 500 } : { color: "var(--text-secondary)" }}
            >
              {STATUS_LABELS[s]}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
