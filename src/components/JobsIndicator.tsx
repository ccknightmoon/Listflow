"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Z } from "@/lib/z-layers";
import { fetchBatches, kickJobs, notifyDone } from "@/lib/jobs/client";
import { isBatchActive, progressLine } from "@/lib/jobs/summary";
import type { BatchProgress } from "@/lib/jobs/types";

const PUBLIC = ["/", "/login", "/privacy", "/terms", "/forgot-password", "/reset-password"];
const ACTIVE_POLL_MS = 6000;

/**
 * Background batches (server queue): a small pill at the top while a batch
 * is grouping/analyzing/listing, linking to /batches. On app open it also
 * runs the sweep (/api/jobs/kick) that restarts any stalled work.
 */
export default function JobsIndicator() {
  const pathname = usePathname() ?? "";
  const isPublic = PUBLIC.includes(pathname) || pathname.startsWith("/account/pending");
  const [active, setActive] = useState<BatchProgress | null>(null);
  const wasActive = useRef(false);

  useEffect(() => {
    if (isPublic) return;
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      const data = await fetchBatches().catch(() => null);
      if (stopped || !data?.available) return;
      const current = data.batches.find(isBatchActive) ?? null;
      setActive(current);
      if (wasActive.current && !current && data.batches[0]) notifyDone(progressLine(data.batches[0]));
      wasActive.current = !!current;
      if (current) {
        void kickJobs(); // keep a dropped chain moving while the app is open
        timer = window.setTimeout(tick, ACTIVE_POLL_MS);
      }
    };
    void kickJobs().then(tick);
    const onStart = () => {
      window.clearTimeout(timer);
      void tick();
    };
    window.addEventListener("listflow:jobs-started", onStart);
    const onVisible = () => document.visibilityState === "visible" && onStart();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("listflow:jobs-started", onStart);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isPublic]);

  if (isPublic || !active || pathname === "/batches") return null;
  return (
    <Link
      href={`/batches?batch=${active.batchId}`}
      className="fixed left-1/2 -translate-x-1/2 top-[calc(8px+env(safe-area-inset-top))] flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold"
      style={{ zIndex: Z.tray, background: "var(--glass-strong)", border: "1px solid var(--glass-line)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", boxShadow: "var(--shadow-card)" }}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--accent)" }} />
      {progressLine(active)}
      <span className="font-normal" style={{ color: "var(--text-secondary)" }}>· you can close the app</span>
    </Link>
  );
}
