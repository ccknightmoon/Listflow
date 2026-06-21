"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Home, FileText, Store, LogOut } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { useEffect, useRef, useState } from "react";

const navItems = [
  { href: "/dashboard", icon: Home, label: "Home" },
  { href: "/drafts", icon: FileText, label: "Drafts" },
  { href: "/store", icon: Store, label: "Store" },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [counts, setCounts] = useState<{ drafts: number; store: number } | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );

  async function fetchCounts() {
    const [draftsRes, storeRes] = await Promise.all([
      supabase.from("drafts").select("id", { count: "exact", head: true }).is("ebay_listing_id", null),
      supabase.from("drafts").select("id", { count: "exact", head: true }).not("ebay_listing_id", "is", null),
    ]);
    setCounts({ drafts: draftsRes.count ?? 0, store: storeRes.count ?? 0 });
  }

  const fetchCountsRef = useRef(fetchCounts);
  fetchCountsRef.current = fetchCounts;

  useEffect(() => { fetchCounts(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = () => fetchCountsRef.current();
    window.addEventListener("listflow:counts-changed", handler);
    return () => window.removeEventListener("listflow:counts-changed", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-[var(--border)] flex justify-around py-2 max-w-md mx-auto">
      {navItems.map(({ href, icon: Icon, label }) => {
        const active = pathname === href;
        const badge = href === "/drafts" ? counts?.drafts : href === "/store" ? counts?.store : 0;
        return (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center gap-1 px-3 py-1"
          >
            <div className="relative">
              <Icon
                className="w-5 h-5"
                style={{ color: active ? "var(--brand-600, #185FA5)" : "var(--text-tertiary)" }}
              />
              {badge != null && badge > 0 && (
                <span
                  className="absolute -top-1 -right-2 min-w-[14px] h-[14px] rounded-full text-white text-[9px] font-medium flex items-center justify-center px-0.5"
                  style={{ background: "var(--brand-600, #185FA5)" }}
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </div>
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
