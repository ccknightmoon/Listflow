"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, ImagePlus, FileText, BarChart2, TrendingUp, Package, ChevronRight, Settings } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import MorphLink from "@/components/MorphLink";
import { createBrowserClient } from "@supabase/ssr";
import { apiFetch } from "@/lib/api";

interface Stats {
  drafts: number;
  active: number;
  weeklyRevenue: number;
  weeklySales: number;
}

function greeting(hour: number) {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [shipCount, setShipCount] = useState<number | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [eyebrow, setEyebrow] = useState("Welcome back");

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
      ),
    []
  );

  useEffect(() => {
    setEyebrow(greeting(new Date().getHours()));

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
    <main className="relative min-h-screen max-w-md mx-auto px-4 pt-5 pb-28 overflow-hidden">
      <div
        className="bloom d1 stagger"
        style={{ width: 260, height: 260, top: -80, left: -60, background: "var(--glow-primary)" }}
      />
      <div
        className="bloom d1 stagger"
        style={{ width: 220, height: 220, top: 40, right: -80, background: "var(--glow-secondary)" }}
      />

      <div
        className="relative flex items-center justify-between mb-3 rounded-3xl px-4 py-3 stagger"
        style={{ background: "var(--glass)", border: "1px solid var(--glass-line)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}
      >
        <div>
          <p className="text-[11px] font-semibold" style={{ color: "var(--text-tertiary)" }}>{eyebrow}</p>
          <h1 className="font-display font-bold text-lg mt-0.5">{displayName ?? "My store"}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-90"
            style={{ background: "var(--glass-strong)", border: "1px solid var(--glass-line)", color: "var(--text-secondary)", transition: "transform .25s var(--spring)" }}
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </Link>
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center font-display font-bold text-sm text-white"
            style={{ background: "var(--accent)" }}
          >
            {displayName ? displayName[0].toUpperCase() : "S"}
          </div>
        </div>
      </div>

      <div className="relative grid grid-cols-[1.3fr_1fr] gap-2.5 mb-2.5">
        <Link
          href="/sales"
          className="card d1 stagger row-span-2 p-4 flex flex-col justify-between active:scale-[.97]"
          style={{ transitionTimingFunction: "var(--spring)" }}
        >
          <div>
            <p className="text-[10.5px] font-bold tracking-wide uppercase" style={{ color: "var(--text-tertiary)" }}>This week</p>
            <p className="font-display font-extrabold text-3xl mt-1.5">
              {revenue !== null ? (revenue === 0 ? "$0" : `$${revenue.toFixed(0)}`) : "—"}
            </p>
          </div>
          {weeklySales !== null && weeklySales > 0 && (
            <p className="text-[11.5px] font-bold mt-2 flex items-center gap-1" style={{ color: "var(--success)" }}>
              <TrendingUp className="w-3.5 h-3.5" /> {weeklySales} sold this week
            </p>
          )}
        </Link>

        <Link
          href="/drafts"
          className="card d2 stagger p-3.5 active:scale-[.97]"
          style={{ transitionTimingFunction: "var(--spring)" }}
        >
          <p className="text-[10px] font-bold" style={{ color: "var(--text-tertiary)" }}>DRAFTS</p>
          <p className="font-display font-extrabold text-xl mt-1.5">{drafts !== null ? drafts : "—"}</p>
        </Link>
        <Link
          href="/store"
          className="card d3 stagger p-3.5 active:scale-[.97]"
          style={{ transitionTimingFunction: "var(--spring)" }}
        >
          <p className="text-[10px] font-bold" style={{ color: "var(--text-tertiary)" }}>ACTIVE</p>
          <p className="font-display font-extrabold text-xl mt-1.5">{active !== null ? active : "—"}</p>
        </Link>

        <Link
          href="/new-listing"
          className="btn btn-primary d4 stagger col-span-2 py-3.5 text-[14.5px]"
          style={{ boxShadow: "0 16px 28px -16px var(--accent-tint)" }}
        >
          <Plus className="w-4 h-4" />
          New listing
        </Link>

        <div className="col-span-2 grid grid-cols-4 gap-2">
          <ActionTile href="/batch-upload" viewTransitionName="batch-panel" icon={ImagePlus} title="Batch upload" delay="d5" />
          <ActionTile href="/drafts" viewTransitionName="drafts-panel" icon={FileText} title="Review drafts" delay="d6" />
          <ActionTile href="/store" viewTransitionName="store-panel" icon={BarChart2} title="View store" delay="d6" />
          <ActionTile href="/sales" viewTransitionName="sales-panel" icon={TrendingUp} title="Sales history" delay="d6" />
        </div>

        <MorphLink
          href="/ship"
          viewTransitionName="ship-panel"
          className="card d6 stagger col-span-2 p-3.5 flex items-center gap-3 active:scale-[.98]"
          style={{
            background: "color-mix(in srgb, var(--danger) 10%, var(--glass))",
            borderColor: "color-mix(in srgb, var(--danger) 26%, var(--glass-line))",
            transitionTimingFunction: "var(--spring)",
          }}
        >
          <div
            className="w-[34px] h-[34px] rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "var(--glass-strong)", color: "var(--danger)" }}
          >
            <Package className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">To ship</p>
            <p className="text-[11.5px]" style={{ color: "var(--text-tertiary)" }}>
              {shipCount === null
                ? "Check pending shipments"
                : shipCount === 0
                ? "All caught up"
                : `Orders ready for packing · tap to view`}
            </p>
          </div>
          {shipCount !== null && shipCount > 0 && (
            <span
              className="text-[11px] font-extrabold min-w-[20px] h-5 rounded-full flex items-center justify-center px-1.5 text-white flex-shrink-0"
              style={{ background: "var(--danger)" }}
            >
              {shipCount}
            </span>
          )}
          <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "var(--danger)" }} />
        </MorphLink>
      </div>

      {!statsLoaded && (
        <p className="text-center text-xs mt-3" style={{ color: "var(--text-tertiary)" }}>Loading your store…</p>
      )}

      <BottomNav />
    </main>
  );
}

function ActionTile({
  href,
  viewTransitionName,
  icon: Icon,
  title,
  delay,
}: {
  href: string;
  viewTransitionName: string;
  icon: React.ElementType;
  title: string;
  delay: string;
}) {
  return (
    <MorphLink
      href={href}
      viewTransitionName={viewTransitionName}
      className={`card ${delay} stagger p-2.5 flex flex-col items-start gap-2 active:scale-[.94]`}
      style={{ transitionTimingFunction: "var(--spring)" }}
    >
      <div
        className="w-[30px] h-[30px] rounded-lg flex items-center justify-center"
        style={{ background: "var(--accent-tint)", color: "var(--accent-soft)" }}
      >
        <Icon className="w-[15px] h-[15px]" />
      </div>
      <p className="text-[11.5px] font-bold leading-tight">{title}</p>
    </MorphLink>
  );
}
