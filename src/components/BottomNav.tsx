"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, BarChart3, Settings, AlertTriangle } from "lucide-react";

const navItems = [
  { href: "/dashboard", icon: Home, label: "Home" },
  { href: "/store", icon: LayoutGrid, label: "Listings" },
  { href: "/sales", icon: BarChart3, label: "Sales" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

// Shown once a seller crosses 75% of this month's AI usage cap (GET
// /api/ai-usage -- see src/lib/ai-usage.ts for the cap itself). There's no
// per-item action to take here, it's purely a heads-up so a seller running
// a big batch isn't blindsided by hitting the cap mid-batch -- see the
// single-banner fix in batch-upload/page.tsx's handleAnalyzeBatch for what
// actually happens once the cap is hit.
const USAGE_WARNING_THRESHOLD = 0.75;

export default function BottomNav() {
  const pathname = usePathname();
  // Tracked per-item (not just CSS :active) because the active route's
  // lift is already an inline transform — combining "lift" and "press"
  // into one computed value here is simpler than fighting inline-style
  // vs. stylesheet specificity for who owns `transform`.
  const [pressed, setPressed] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);

  useEffect(() => {
    fetch("/api/ai-usage")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.used === "number" && typeof data.limit === "number" && data.limit > 0) {
          setUsage({ used: data.used, limit: data.limit });
        }
      })
      .catch(() => {});
  }, []);

  return (
    <>
      {usage && usage.used / usage.limit >= USAGE_WARNING_THRESHOLD && (
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
          <span>
            {usage.used >= usage.limit
              ? "You've reached this month's AI usage limit — it resets on the 1st."
              : `You've used ${Math.round((usage.used / usage.limit) * 100)}% of this month's AI limit (${usage.used}/${usage.limit}) — resets on the 1st.`}
          </span>
        </div>
      )}
      <nav
        className="fixed bottom-3 left-3 right-3 max-w-md mx-auto flex justify-around py-2 px-1 rounded-2xl"
        style={{
          background: "var(--glass-strong)",
          border: "1px solid var(--glass-line)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = pathname === href;
          const isPressed = pressed === href;
          return (
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
        })}
      </nav>
    </>
  );
}
