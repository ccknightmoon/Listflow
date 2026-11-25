"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, BarChart3, MessageCircle, Tag, Truck, Settings, Plus, AlertTriangle, type LucideIcon } from "lucide-react";
import { Z } from "@/lib/z-layers";
import { isSidebarVisible, isSidebarLinkActive, SIDEBAR_LINKS, SIDEBAR_WIDTH_PX } from "@/lib/nav-config";
import { useAiUsageWarning } from "@/lib/use-ai-usage-warning";
import NewListingSheet from "@/components/NewListingSheet";

const ICONS: Record<string, LucideIcon> = {
  "/dashboard": Home,
  "/inventory": LayoutGrid,
  "/sales": BarChart3,
  "/messages": MessageCircle,
  "/offers": Tag,
  "/ship": Truck,
  "/settings": Settings,
};

/**
 * Desktop navigation (lg and up). Purely CSS-gated (`hidden lg:flex`), so
 * phones never render it visibly and the bottom bar stays exactly as is.
 * Sits on the nav layer of src/lib/z-layers.ts: sheets/modals (and their
 * backdrop) cover it, the tray and toasts float above content beside it.
 */
export default function Sidebar() {
  const pathname = usePathname();
  const visible = isSidebarVisible(pathname);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { showWarning, message } = useAiUsageWarning();

  // Reserve the sidebar's width (only applied from lg up, in globals.css).
  useEffect(() => {
    const root = document.documentElement;
    if (visible) root.style.setProperty("--sidebar-space", `${SIDEBAR_WIDTH_PX}px`);
    else root.style.removeProperty("--sidebar-space");
  }, [visible]);

  if (!visible) return null;

  return (
    <>
      <aside
        aria-label="Main"
        data-testid="sidebar"
        className="hidden lg:flex fixed left-0 top-0 bottom-0 flex-col gap-1 px-3 py-5"
        style={{
          width: SIDEBAR_WIDTH_PX,
          zIndex: Z.nav,
          background: "var(--glass-strong)",
          borderRight: "1px solid var(--glass-line)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        <Link href="/dashboard" className="flex items-center gap-2.5 px-2 mb-5">
          <span className="w-9 h-9 rounded-xl flex items-center justify-center font-display font-bold text-sm text-white" style={{ background: "var(--accent)" }}>LF</span>
          <span className="font-display font-bold text-lg">Listflow</span>
        </Link>

        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="tap flex items-center justify-center gap-2 h-11 rounded-xl font-semibold text-sm text-white mb-4"
          style={{ background: "var(--accent)", boxShadow: "0 6px 18px color-mix(in srgb, var(--accent) 35%, transparent)" }}
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} /> New listing
        </button>

        <nav className="flex flex-col gap-0.5">
          {SIDEBAR_LINKS.map((l) => {
            const Icon = ICONS[l.href];
            const active = isSidebarLinkActive(l.href, pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className="flex items-center gap-3 h-10 px-3 rounded-xl text-sm font-medium transition-colors hover:bg-[var(--glass)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                style={{ background: active ? "var(--accent-tint)" : undefined, color: active ? "var(--accent)" : "var(--text-secondary)" }}
              >
                <Icon className="w-[18px] h-[18px]" />
                {l.label}
              </Link>
            );
          })}
        </nav>

        {showWarning && (
          <div
            className="mt-auto flex items-start gap-2 p-2.5 rounded-xl text-xs"
            style={{ background: "var(--warning-bg)", border: "1px solid var(--warning-border)" }}
          >
            <AlertTriangle className="w-4 h-4 flex-none" style={{ color: "var(--danger)" }} />
            <span>{message}</span>
          </div>
        )}
      </aside>
      <NewListingSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
