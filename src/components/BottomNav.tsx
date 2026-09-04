"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, BarChart3, Settings } from "lucide-react";

const navItems = [
  { href: "/dashboard", icon: Home, label: "Home" },
  { href: "/store", icon: LayoutGrid, label: "Listings" },
  { href: "/sales", icon: BarChart3, label: "Sales" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
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
        return (
          <Link
            key={href}
            href={href}
            className="relative flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-transform"
            style={{
              background: active ? "var(--accent-tint)" : "transparent",
              transform: active ? "translateY(-1px)" : "none",
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
  );
}
