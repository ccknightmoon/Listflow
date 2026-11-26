"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import HaulsPanel from "@/components/business/HaulsPanel";

// Business: the money side of reselling. Phase 1: hauls + profit.
const TABS = [{ id: "hauls", label: "Hauls & profit" }] as const;
type TabId = (typeof TABS)[number]["id"];

export default function BusinessPage() {
  const [tab, setTab] = useState<TabId>("hauls");
  return (
    <main className="relative min-h-screen max-w-md lg:max-w-[1100px] mx-auto px-5 lg:px-8 pt-6 lg:pt-8 pb-24">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/dashboard" aria-label="Back to Home" className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center flex-none lg:hidden" style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}>
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-xl font-medium flex-1">Business</h1>
      </div>
      <div className="flex gap-2 mb-4 overflow-x-auto" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} type="button" onClick={() => setTab(t.id)}
            className="text-xs px-3 py-1.5 rounded-full whitespace-nowrap"
            style={{ background: tab === t.id ? "var(--accent-tint)" : "var(--glass)", color: tab === t.id ? "var(--accent-soft)" : "var(--text-secondary)", border: "1px solid var(--glass-line)" }}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "hauls" && <HaulsPanel />}
    </main>
  );
}
