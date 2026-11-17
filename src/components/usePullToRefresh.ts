"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Pull down from the top of the page to refresh (mobile). Returns how far
 * the user has pulled (0..1) so the page can show an indicator.
 */
export function usePullToRefresh(onRefresh: () => void | Promise<void>, threshold = 70) {
  const [pull, setPull] = useState(0);
  const start = useRef<number | null>(null);
  const cb = useRef(onRefresh);
  useEffect(() => { cb.current = onRefresh; }, [onRefresh]);

  useEffect(() => {
    function down(e: TouchEvent) {
      start.current = window.scrollY <= 0 ? e.touches[0].clientY : null;
    }
    function move(e: TouchEvent) {
      if (start.current == null) return;
      const d = e.touches[0].clientY - start.current;
      setPull(d > 0 ? Math.min(1, d / threshold) : 0);
    }
    function up() {
      if (start.current != null && pull >= 1) void cb.current();
      start.current = null;
      setPull(0);
    }
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
  }, [pull, threshold]);

  return pull;
}
