"use client";

// "+ Store intro will be added when listed" (tap to preview).
// Shown on review cards instead of putting the intro into the editable
// description, so cards stay clean. The real intro is added at publish time
// (src/lib/store-intro.ts). Renders nothing when the intro is off or empty.

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface IntroSettings { enabled: boolean; text: string }

// One fetch per page load, shared by every card on the page.
let cache: IntroSettings | null = null;
let inflight: Promise<IntroSettings> | null = null;
const listeners = new Set<(s: IntroSettings) => void>();

function loadIntro(): Promise<IntroSettings> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { storeIntroEnabled?: boolean; storeIntroText?: string }) => ({ enabled: d.storeIntroEnabled === true, text: typeof d.storeIntroText === "string" ? d.storeIntroText : "" }))
      .catch(() => ({ enabled: false, text: "" }))
      .then((s) => { cache = s; inflight = null; return s; });
  }
  return inflight;
}

/** Settings calls this after saving so open pages pick up the change. */
export function setStoreIntroCache(s: IntroSettings) {
  cache = s;
  listeners.forEach((l) => l(s));
}

export function StoreIntroHintView({ text, className = "" }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className} onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] inline-flex items-center gap-1"
        style={{ color: "var(--text-tertiary)" }}
        aria-expanded={open}
      >
        + Store intro will be added when listed
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <p
          className="text-[11px] mt-1 p-2 rounded-lg leading-relaxed whitespace-pre-line"
          style={{ background: "var(--glass)", color: "var(--text-secondary)" }}
        >
          {text.trim()}
        </p>
      )}
    </div>
  );
}

export default function StoreIntroHint({ className }: { className?: string }) {
  const [s, setS] = useState<IntroSettings | null>(cache);
  useEffect(() => {
    let alive = true;
    listeners.add(setS);
    void loadIntro().then((v) => { if (alive) setS(v); });
    return () => { alive = false; listeners.delete(setS); };
  }, []);
  if (!s?.enabled || !s.text.trim()) return null;
  return <StoreIntroHintView text={s.text} className={className} />;
}
