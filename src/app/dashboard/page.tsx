"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, ImagePlus, FileText, BarChart2, ChevronRight } from "lucide-react";
import BottomNav from "@/components/BottomNav";

interface Stats {
  drafts: number;
  active: number;
  weeklyRevenue: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((data) => setStats(data))
      .catch(() => {});
  }, []);

  const drafts = stats?.drafts ?? null;
  const active = stats?.active ?? null;
  const revenue = stats?.weeklyRevenue ?? null;

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-[var(--text-secondary)]">Welcome back</p>
          <h1 className="text-xl font-medium">My store</h1>
        </div>
        <div className="w-9 h-9 rounded-full bg-brand-50 flex items-center justify-center text-brand-600 font-medium text-sm">
          S
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-6">
        <Stat label="drafts" value={drafts !== null ? String(drafts) : "—"} />
        <Stat label="active" value={active !== null ? String(active) : "—"} />
        <Stat
          label="this week"
          value={revenue !== null ? (revenue === 0 ? "$0" : `$${revenue.toFixed(0)}`) : "—"}
        />
      </div>

      <Link href="/new-listing" className="btn btn-primary w-full mb-6">
        <Plus className="w-4 h-4" />
        New listing
      </Link>

      <p className="text-sm text-[var(--text-secondary)] mb-2">Quick actions</p>
      <div className="flex flex-col gap-2">
        <QuickAction
          href="/batch-upload"
          icon={ImagePlus}
          title="Batch upload"
          subtitle="Add multiple items at once"
        />
        <QuickAction
          href="/drafts"
          icon={FileText}
          title="Review drafts"
          subtitle={drafts !== null ? `${drafts} ready to post` : "Loading…"}
        />
        <QuickAction
          href="/store"
          icon={BarChart2}
          title="View store"
          subtitle={active !== null ? `${active} active listings` : "Loading…"}
        />
      </div>

      <BottomNav />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3 text-center">
      <p className="text-xl font-medium">{value}</p>
      <p className="text-[11px] text-[var(--text-secondary)]">{label}</p>
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  title,
  subtitle,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  subtitle: string;
}) {
  return (
    <Link href={href} className="card flex items-center gap-3 p-3">
      <Icon className="w-5 h-5 text-[var(--text-secondary)]" />
      <div className="flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-[var(--text-secondary)]">{subtitle}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)]" />
    </Link>
  );
}
