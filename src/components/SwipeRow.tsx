"use client";

import { useRef, useState, type ReactNode } from "react";
import { dragOffset, isHorizontalIntent, settleOffset, SWIPE_ACTION_WIDTH } from "@/lib/swipe";

export interface SwipeAction {
  label: string;
  icon?: ReactNode;
  tone?: "accent" | "danger" | "neutral";
  onAction: () => void;
}

/**
 * Swipe a row left to reveal quick actions (one-handed use). Vertical
 * scrolling is untouched; a tap on an open row just closes it. The same
 * actions stay reachable without swiping elsewhere (selection bar, editor).
 */
export default function SwipeRow({ actions, children, className }: { actions: SwipeAction[]; children: ReactNode; className?: string }) {
  const width = actions.length * SWIPE_ACTION_WIDTH;
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const g = useRef<{ x: number; y: number; t: number; start: number; horizontal: boolean | null; lastX: number; lastT: number } | null>(null);
  const suppressClick = useRef(false);

  const colors = { accent: "var(--accent)", danger: "var(--danger)", neutral: "var(--text-tertiary)" };
  if (actions.length === 0) return <div className={className}>{children}</div>;

  return (
    <div className={`relative overflow-hidden rounded-[18px] ${className ?? ""}`}>
      {/* Only drawn while revealed: cards are translucent glass, so a
          hidden panel underneath would show through. */}
      {offset < 0 && (
      <div className="absolute inset-y-0 right-0 flex" style={{ width }}>
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => { setOffset(0); a.onAction(); }}
            className="flex flex-col items-center justify-center gap-1 text-[11px] font-semibold text-white"
            style={{ width: SWIPE_ACTION_WIDTH, background: colors[a.tone ?? "neutral"] }}
          >
            {a.icon}
            {a.label}
          </button>
        ))}
      </div>
      )}
      <div
        style={{ transform: `translateX(${offset}px)`, transition: dragging ? "none" : "transform .22s var(--spring)", touchAction: "pan-y" }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") return;
          g.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, start: offset, horizontal: null, lastX: e.clientX, lastT: e.timeStamp };
        }}
        onPointerMove={(e) => {
          const s = g.current;
          if (!s) return;
          const dx = e.clientX - s.x, dy = e.clientY - s.y;
          if (s.horizontal === null) s.horizontal = isHorizontalIntent(dx, dy);
          if (!s.horizontal) return;
          setDragging(true);
          s.lastX = e.clientX; s.lastT = e.timeStamp;
          setOffset(dragOffset(s.start, dx, width));
        }}
        onPointerUp={(e) => {
          const s = g.current;
          g.current = null;
          if (!s || !s.horizontal) return;
          const dt = Math.max(1, e.timeStamp - s.lastT);
          const v = (e.clientX - s.lastX) / dt;
          setDragging(false);
          setOffset((o) => settleOffset(o, v, width));
          suppressClick.current = true;
        }}
        onPointerCancel={() => { g.current = null; setDragging(false); setOffset((o) => settleOffset(o, 0, width)); }}
        onClickCapture={(e) => {
          if (suppressClick.current || offset !== 0) {
            suppressClick.current = false;
            e.stopPropagation();
            e.preventDefault();
            if (offset !== 0) setOffset(0);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
