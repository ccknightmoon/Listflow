"use client";

// "Compare with active listings" under the draft editor's price: a price
// RANGE from similar items for sale on eBay right now, weighted by brand,
// size and condition, with a confidence label. Suggestion only -- "Use"
// just fills the price field; nothing is saved or changed on eBay.

import { useState } from "react";
import { ExternalLink, Loader2, Scale } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { CompSummary } from "@/lib/comp-weighting";

interface Props {
  draftId: string;
  title: string;
  brand: string;
  size: string;
  condition: string;
  onUsePrice: (price: number) => void;
}

const CONF_COLOR: Record<CompSummary["confidence"], string> = { high: "var(--success)", medium: "var(--warning, #b7791f)", low: "var(--text-tertiary)" };

export default function CompsPanel({ draftId, title, brand, size, condition, onUsePrice }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [summary, setSummary] = useState<CompSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setState("loading");
    setError(null);
    try {
      const r = await apiFetch<{ summary?: CompSummary | null; error?: string }>("/api/pricing/comps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId, title, brand, size, condition }),
      });
      if (r.error) throw new Error(r.error);
      setSummary(r.summary ?? null);
      setState("done");
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  }

  return (
    <div className="mt-2">
      <button type="button" className="btn text-xs py-1.5 px-2.5" onClick={() => void load()} disabled={state === "loading"}>
        {state === "loading" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scale className="w-3.5 h-3.5" />}
        {state === "done" ? "Compare again" : "Compare with active listings"}
      </button>
      {state === "error" && <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>{error}</p>}
      {state === "done" && !summary && (
        <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>No similar items for sale were found. Try a shorter title or add the brand.</p>
      )}
      {state === "done" && summary && (
        <div className="card p-3 mt-2 text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-semibold text-sm">
              {formatMoney(summary.low)} – {formatMoney(summary.high)} <span className="font-normal" style={{ color: "var(--text-secondary)" }}>· typical {formatMoney(summary.typical)}</span>
            </p>
            <span className="font-semibold" style={{ color: CONF_COLOR[summary.confidence] }}>{summary.confidence} confidence</span>
          </div>
          <p className="mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            {summary.used} similar listing{summary.used === 1 ? "" : "s"} ({summary.effectiveCount} close matches by brand, size and condition)
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {summary.examples.map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="truncate" style={{ color: "var(--text-secondary)" }} title={c.why.join(", ")}>{c.title}</span>
                <span className="flex-none tabular-nums">
                  {formatMoney(c.value)}
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex ml-1 align-middle" aria-label="Open on eBay"><ExternalLink className="w-3 h-3" /></a>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2" style={{ color: "var(--text-tertiary)" }}>{summary.note}</p>
          <div className="flex gap-2 mt-2">
            <button type="button" className="btn text-xs py-1.5 px-2.5" onClick={() => onUsePrice(summary.typical)}>Use {formatMoney(summary.typical)}</button>
            <button type="button" className="btn text-xs py-1.5 px-2.5" onClick={() => onUsePrice(summary.low)}>Use {formatMoney(summary.low)} (sell faster)</button>
          </div>
        </div>
      )}
    </div>
  );
}
