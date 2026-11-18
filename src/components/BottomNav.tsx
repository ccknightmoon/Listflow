"use client";

import { useEffect, useState } from "react";
import Sheet, { useAnyOverlayOpen } from "@/components/Sheet";
import { NAV_SPACE_PX, Z } from "@/lib/z-layers";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Home, LayoutGrid, BarChart3, AlertTriangle, Plus, MoreHorizontal, FileText, MessageCircle, Tag, Truck, Settings, type LucideIcon } from "lucide-react";
import { useAiUsageWarning } from "@/lib/use-ai-usage-warning";
import { isNavVisible, NAV_TABS, MORE_LINKS } from "@/lib/nav-config";
import NewListingSheet from "@/components/NewListingSheet";

const TAB_ICONS: Record<string, LucideIcon> = { "/dashboard": Home, "/store": LayoutGrid, "/sales": BarChart3 };
const MORE_ICONS: Record<string, LucideIcon> = { "/drafts": FileText, "/messages": MessageCircle, "/offers": Tag, "/ship": Truck, "/settings": Settings };

// Height of the bar (without the safe-area inset) -- PublishTray and the
// AI-usage banner sit just above it.
export const NAV_BAR_HEIGHT = 64;

// Rendered once in the root layout; shows only on the routes listed in
// src/lib/nav-config.ts. Four slots + the centre "+": Home, Listings, +,
// Sales, More.
export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { showWarning, message } = useAiUsageWarning();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const overlayOpen = useAnyOverlayOpen();
  const visible = isNavVisible(pathname);

  // Tell the page how much room the nav takes so the last item is never
  // hidden behind it (globals.css pads <body> by --nav-space + --tray-offset).
  useEffect(() => {
    const root = document.documentElement;
    if (visible) root.style.setProperty("--nav-space", `calc(${NAV_SPACE_PX}px + env(safe-area-inset-bottom))`);
    else root.style.removeProperty("--nav-space");
  }, [visible]);

  if (!visible) return null;

  const moreActive = MORE_LINKS.some((l) => l.href === pathname);
  const tab = (href: string, label: string, Icon: LucideIcon) => {
    const active = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className="tap flex flex-col items-center justify-center gap-0.5 min-w-[56px] min-h-[48px] rounded-xl"
        style={{ background: active ? "var(--accent-tint)" : "transparent" }}
      >
        <Icon className="w-[22px] h-[22px]" style={{ color: active ? "var(--accent)" : "var(--text-tertiary)" }} />
        <span className="text-[10.5px] font-medium" style={{ color: active ? "var(--accent)" : "var(--text-tertiary)" }}>{label}</span>
      </Link>
    );
  };

  return (
    <>
      {showWarning && !overlayOpen && (
        <div
          className="lg:hidden fixed left-3 right-3 max-w-md mx-auto flex items-center gap-2 py-2 px-3 rounded-xl text-xs"
          style={{
            bottom: `calc(${NAV_BAR_HEIGHT + 20}px + env(safe-area-inset-bottom) + var(--tray-offset, 0px))`,
            zIndex: Z.nav,
            background: "var(--warning-bg)",
            border: "1px solid var(--warning-border)",
            color: "var(--text-primary)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "var(--danger)" }} />
          <span>{message}</span>
        </div>
      )}
      <nav
        aria-label="Main"
        aria-hidden={overlayOpen || undefined}
        className="lg:hidden fixed left-3 right-3 max-w-md mx-auto grid grid-cols-5 items-center px-1.5 rounded-2xl"
        style={{
          bottom: "calc(12px + env(safe-area-inset-bottom))",
          height: NAV_BAR_HEIGHT,
          zIndex: Z.nav,
          // Steps out of the way while any sheet/modal is open.
          opacity: overlayOpen ? 0 : 1,
          pointerEvents: overlayOpen ? "none" : undefined,
          transform: overlayOpen ? "translateY(12px)" : undefined,
          transition: "opacity .15s ease, transform .15s ease",
          background: "var(--glass-strong)",
          border: "1px solid var(--glass-line)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        {tab(NAV_TABS[0].href, NAV_TABS[0].label, TAB_ICONS[NAV_TABS[0].href])}
        {tab(NAV_TABS[1].href, NAV_TABS[1].label, TAB_ICONS[NAV_TABS[1].href])}
        <div className="flex justify-center">
          <button
            type="button"
            aria-label="Start a listing"
            onClick={() => setSheetOpen(true)}
            className="tap w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{ background: "var(--accent)", color: "white", boxShadow: "0 6px 18px color-mix(in srgb, var(--accent) 40%, transparent)" }}
          >
            <Plus className="w-6 h-6" strokeWidth={2.5} />
          </button>
        </div>
        {tab(NAV_TABS[2].href, NAV_TABS[2].label, TAB_ICONS[NAV_TABS[2].href])}
        <button
          type="button"
          aria-label="More"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
          className="tap flex flex-col items-center justify-center gap-0.5 min-w-[56px] min-h-[48px] rounded-xl"
          style={{ background: moreActive ? "var(--accent-tint)" : "transparent" }}
        >
          <MoreHorizontal className="w-[22px] h-[22px]" style={{ color: moreActive ? "var(--accent)" : "var(--text-tertiary)" }} />
          <span className="text-[10.5px] font-medium" style={{ color: moreActive ? "var(--accent)" : "var(--text-tertiary)" }}>More</span>
        </button>
      </nav>

      <NewListingSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        {MORE_LINKS.map((l) => {
          const Icon = MORE_ICONS[l.href];
          return (
            <button
              key={l.href}
              type="button"
              onClick={() => { setMoreOpen(false); router.push(l.href); }}
              className="tap w-full flex items-center gap-3 min-h-[52px] px-3 rounded-2xl text-left"
              style={{ background: pathname === l.href ? "var(--accent-tint)" : "transparent" }}
            >
              <Icon className="w-5 h-5" style={{ color: "var(--text-secondary)" }} />
              <span className="text-sm font-medium">{l.label}</span>
            </button>
          );
        })}
      </Sheet>
    </>
  );
}
