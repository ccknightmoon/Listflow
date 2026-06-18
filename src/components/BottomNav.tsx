"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Home, FileText, BarChart2, LogOut } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";

const navItems = [
  { href: "/dashboard", icon: Home, label: "Home" },
  { href: "/drafts", icon: FileText, label: "Drafts" },
  { href: "/membership", icon: BarChart2, label: "Plans" },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-[var(--border)] flex justify-around py-2 max-w-md mx-auto">
      {navItems.map(({ href, icon: Icon, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center gap-1 px-3 py-1"
          >
            <Icon
              className="w-5 h-5"
              style={{ color: active ? "var(--brand-600, #185FA5)" : "var(--text-tertiary)" }}
            />
            <span
              className="text-[10px]"
              style={{ color: active ? "var(--brand-600, #185FA5)" : "var(--text-tertiary)" }}
            >
              {label}
            </span>
          </Link>
        );
      })}

      <button
        onClick={handleSignOut}
        className="flex flex-col items-center gap-1 px-3 py-1"
      >
        <LogOut className="w-5 h-5" style={{ color: "var(--text-tertiary)" }} />
        <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>Sign out</span>
      </button>
    </nav>
  );
}
