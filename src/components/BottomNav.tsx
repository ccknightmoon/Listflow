"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, FileText, BarChart2, Settings } from "lucide-react";

const items = [
  { href: "/dashboard", icon: Home, label: "Home" },
  { href: "/drafts", icon: FileText, label: "Drafts" },
  { href: "/membership", icon: BarChart2, label: "Plans" },
  { href: "/login", icon: Settings, label: "Account" },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-[var(--border)] flex justify-around py-2 max-w-md mx-auto">
      {items.map(({ href, icon: Icon, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center gap-1 px-3 py-1"
          >
            <Icon
              className="w-5 h-5"
              style={{
                color: active ? "var(--brand-600, #185FA5)" : "var(--text-tertiary)",
              }}
            />
            <span
              className="text-[10px]"
              style={{
                color: active ? "var(--brand-600, #185FA5)" : "var(--text-tertiary)",
              }}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
