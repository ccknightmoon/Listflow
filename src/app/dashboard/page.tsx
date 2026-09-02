"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, ImagePlus, FileText, BarChart2, TrendingUp, Package, ChevronRight, Settings } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import { createBrowserClient } from "@supabase/ssr";
import { apiFetch } from "@/lib/api";

interface Stats {
  drafts: number;
  active: number;
  weeklyRevenue: number;
  weeklySales: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [shipCount, setShipCount] = useState<number | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
      ),
    []
  );

  useEffect(() => {
    void (async () => {
      try {
        const statsData = await apiFetch<{ drafts: number; active: number; weeklyRevenue: number; weeklySales: number }>("/api/dashboard/stats");
        setStats(statsData);
      } catch {
        setStats(null);
      } finally {
        setStatsLoaded(true);
      }

      try {
        const shipData = await apiFetch<{ count?: number; error?: string }>("/api/ebay/ship");
        if (!shipData.error) setShipCount(shipData.count ?? 0);
      } catch {
        setShipCount(null);
      }
    })();

    void (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      const name =
        user?.user_metadata?.full_name ||
        user?.user_metadata?.name ||
        user?.email?.split("@")[0] ||
        null;
      setDisplayName(name);
    })();
  }, [supabase]);

  const drafts = stats?.drafts ?? null;
  const active = stats?.active ?? null;
  const revenue = stats?.weeklyRevenue ?? null;
  const weeklySales = stats?.weeklySales ?? null;

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-[var(--text-secondary)]">Welcome back</p>
          <h1 className="text-xl font-medium">{displayName ?? "My store"}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-page)]"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </Link>
          <div className="w-9 h-9 rounded-full bg-brand-50 flex items-center justify-center text-brand-600 font-medium text-sm">
            {displayName ? displayName[0].toUpperCase() : "S"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-6">
        <Stat label="drafts" value={drafts !== null ? String(drafts) : "—"} />
        <Stat label="active" value={active !== null ? String(active) : "—"} />
        <Stat
          label="this week"
          value={revenue !== null ? (revenue === 0 ? "$0" : `$${revenue.toFixed(0)}`) : "—"}
          sub={weeklySales !== null && weeklySales > 0 ? `${weeklySales} sold` : undefined}
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
          subtitle={drafts !== null ? `${drafts} ready to post` : statsLoaded ? "Tap to view drafts" : "Loading…"}
        />
        <QuickAction
          href="/store"
          icon={BarChart2}
          title="View store"
          subtitle={active !== null ? `${active} active listings` : statsLoaded ? "Tap to view store" : "Loading…"}
        />
        <QuickAction
          href="/sales"
          icon={TrendingUp}
          title="Sales history"
          subtitle="See what you've sold"
        />
        <QuickAction
          href="/ship"
          icon={Package}
          title="To ship"
          subtitle={
            shipCount === null
              ? "Check pending shipments"
              : shipCount === 0
              ? "All caught up"
              : `${shipCount} item${shipCount !== 1 ? "s" : ""} awaiting shipment`
          }
          urgent={shipCount !== null && shipCount > 0}
        />
      </div>

      <BottomNav />
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-3 text-center">
      <p className="text-xl font-medium">{value}</p>
      <p className="text-[11px] text-[var(--text-secondary)]">{label}</p>
      {sub && <p className="text-[10px] text-green-600 mt-0.5">{sub}</p>}
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  title,
  subtitle,
  urgent,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  subtitle: string;
  urgent?: boolean;
}) {
  return (
    <Link href={href} className="card flex items-center gap-3 p-3">
      <Icon className={`w-5 h-5 ${urgent ? "text-[var(--brand-600)]" : "text-[var(--text-secondary)]"}`} />
      <div className="flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className={`text-xs ${urgent ? "text-[var(--brand-600)] font-medium" : "text-[var(--text-secondary)]"}`}>
          {subtitle}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)]" />
    </Link>
  );
}
