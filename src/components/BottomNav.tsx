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
        const badge = href === "/drafts" ? counts?.drafts : href === "/store" ? counts?.store : 0;
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
            <div className="relative">
              <Icon
                className="w-5 h-5"
                style={{ color: active ? "var(--accent)" : "var(--text-tertiary)" }}
              />
              {badge != null && badge > 0 && (
                <span
                  className="absolute -top-1 -right-2 min-w-[14px] h-[14px] rounded-full text-white text-[9px] font-medium flex items-center justify-center px-0.5"
                  style={{ background: "var(--accent)" }}
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </div>
            <span
              className="text-[10px] font-medium"
              style={{ color: active ? "var(--accent)" : "var(--text-tertiary)" }}
            >
              {label}
            </span>
          </Link>
        );
      })}

      <button
        onClick={handleSignOut}
        className="flex flex-col items-center gap-1 px-3 py-1.5 active:scale-95 transition-transform"
        style={{ transitionTimingFunction: "var(--spring)" }}
      >
        <LogOut className="w-5 h-5" style={{ color: "var(--text-tertiary)" }} />
        <span className="text-[10px] font-medium" style={{ color: "var(--text-tertiary)" }}>Sign out</span>
      </button>
    </nav>
  );
}
