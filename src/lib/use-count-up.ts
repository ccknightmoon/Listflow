import { useEffect, useRef, useState } from "react";

// Animates a displayed number counting up from wherever it last settled to
// a new `target`, instead of the value just popping straight to the new
// figure. Used on the handful of headline numbers (revenue, item counts)
// where a bit of "counting up" motion reads as a nicer first impression
// than a flat number appearing — most noticeably on first load, going
// from nothing to the real total.
export function useCountUp(target: number | null, durationMs = 700): number | null {
  const [display, setDisplay] = useState<number | null>(target);
  const fromRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === null) {
      setDisplay(null);
      return;
    }

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const from = fromRef.current;
    const to = target;
    if (from === to || reduceMotion) {
      setDisplay(to);
      fromRef.current = to;
      return;
    }

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      // Ease-out cubic — quick start, gentle settle. A spring overshoot
      // (like the app's tap/press motion elsewhere) reads as a glitch on
      // a *number*, so this stays a plain deceleration curve instead.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return display;
}
