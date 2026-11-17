"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, BarChart3, Settings, AlertTriangle, Plus } from "lucide-react";
import NewListingSheet from "@/components/NewListingSheet";
import { useAiUsageWarning } from "@/lib/use-ai-usage-warning";

const navItems = [
  { href: "/dashboard", icon: Home, label: "Home" },
  { href: "/store", icon: LayoutGrid, label: "Listings" },
  { href: "/sales", icon: BarChart3, label: "Sales" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export default function BottomNav() {
  const pathname = usePathname();
  // Tracked per-item (not just CSS :active) because the active route's
  // lift is already an inline transform — combining "lift" and "press"
  // into one computed value here is simpler than fighting inline-style
  // vs. stylesheet specificity for who owns `transform`.
  const [pressed, setPressed] = useState<string | null>(null);
  // See src/lib/use-ai-usage-warning.ts -- shared with batch-upload/page.tsx
  // (which doesn't render this nav, so it shows its own copy of the same
  // banner directly) so both stay in sync on wording/threshold.
  const { showWarning, message } = useAiUsageWarning();
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      {showWarning && (
        <div
          className="fixed bottom-[84px] left-3 right-3 max-w-md mx-auto flex items-center gap-2 py-2 px-3 rounded-xl text-xs"
          style={{
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
        className="fixed bottom-3 left-3 right-3 z-40 max-w-md mx-auto flex justify-around items-center py-2 px-1 rounded-2xl"
        style={{
          background: "var(--glass-strong)",
          border: "1px solid var(--glass-line)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        {navItems.map(({ href, icon: Icon, label }, idx) => {
          const active = pathname === href;
          const isPressed = pressed === href;
          const link = (
            <Link
              key={href}
              href={href}
              className="relative flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl"
              onPointerDown={() => setPressed(href)}
              onPointerUp={() => setPressed(null)}
              onPointerLeave={() => setPressed(null)}
              onPointerCancel={() => setPressed(null)}
              style={{
                background: active ? "var(--accent-tint)" : "transparent",
                transform: `translateY(${active ? -1 : 0}px) scale(${isPressed ? 0.92 : 1})`,
                transition: "background-color .2s ease, transform .2s var(--spring)",
              }}
            >
              <Icon
                className="w-5 h-5"
                style={{ color: active ? "var(--accent)" : "var(--text-tertiary)" }}
              />
              <span
                className="text-[10px] font-medium"
                style={{ color: active ? "var(--accent)" : "var(--text-tertiary)" }}
              >
                {label}
              </span>
            </Link>
          );
          // The "+" sits in the middle: one tap to the camera from any page.
          if (idx !== 2) return link;
          return [
            <button
              key="new"
              type="button"
              aria-label="Start a listing"
              onClick={() => setSheetOpen(true)}
              className="tap relative -mt-5 w-14 h-14 rounded-2xl flex items-center justify-center flex-none"
              style={{
                background: "var(--accent)",
                color: "white",
                boxShadow: "0 8px 24px color-mix(in srgb, var(--accent) 45%, transparent)",
              }}
            >
              <Plus className="w-7 h-7" strokeWidth={2.5} />
            </button>,
            link,
          ];
        })}
      </nav>
      <NewListingSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
