"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, Ruler, ZoomIn, Sparkles, Upload, FileText } from "lucide-react";
import { getPriceSuggestion, Condition, PriceSuggestion } from "@/lib/pricing";

const CONDITIONS: Condition[] = [
  "New with tags",
  "New without tags",
  "Excellent used",
  "Good - minor flaws",
  "Fair - notable flaws",
];

export default function NewListingPage() {
  const [title, setTitle] = useState("");
  const [condition, setCondition] = useState<Condition>("Excellent used");
  const [flaws, setFlaws] = useState("");
  const [result, setResult] = useState<PriceSuggestion | null>(null);

  function handleAnalyze() {
    const suggestion = getPriceSuggestion(condition, flaws.trim().length > 0);
    setResult(suggestion);
  }

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-medium">New listing</h1>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <PhotoSlot icon={Camera} label="Front" />
        <PhotoSlot icon={Ruler} label="Measure" />
        <PhotoSlot icon={ZoomIn} label="Flaw" />
      </div>

      <div className="bg-brand-50 rounded-lg px-3 py-2 flex items-center gap-2 mb-4">
        <Sparkles className="w-4 h-4 text-brand-600" />
        <p className="text-xs text-brand-800">
          AI will detect brand, item type, and condition from your photos
        </p>
      </div>

      <div className="flex flex-col gap-3 mb-4">
        <input
          className="input"
          placeholder="Title (auto-filled by AI)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <select
          className="input"
          value={condition}
          onChange={(e) => setCondition(e.target.value as Condition)}
        >
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <textarea
          className="input"
          rows={2}
          placeholder="Flaw notes (e.g. small stain on left cuff)"
          value={flaws}
          onChange={(e) => setFlaws(e.target.value)}
        />
      </div>

      <button onClick={handleAnalyze} className="btn btn-primary w-full mb-4">
        <Sparkles className="w-4 h-4" />
        Analyze & price
      </button>

      {result && (
        <div className="card p-4">
          <p className="text-xs text-[var(--text-secondary)] mb-1">
            Suggested listing price
          </p>
          <p className="text-2xl font-medium mb-3">${result.suggestedPrice}</p>

          <div className="grid grid-cols-3 gap-2 mb-3">
            <MiniStat label="Avg sold" value={`$${result.avgSold}`} />
            <MiniStat
              label="Active range"
              value={`$${result.activeRangeLow}-${result.activeRangeHigh}`}
            />
            <MiniStat
              label="Sell odds"
              value={result.sellOdds}
              highlight={result.sellOdds === "High"}
            />
          </div>

          <p className="text-xs text-[var(--text-tertiary)] mb-3">
            Based on {result.comparableSoldCount} comparable sold listings and{" "}
            {result.comparableActiveCount} active listings
          </p>

          <div className="flex gap-2">
            <button className="btn flex-1">
              <FileText className="w-4 h-4" />
              Save draft
            </button>
            <button className="btn btn-primary flex-1">
              <Upload className="w-4 h-4" />
              List on eBay
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function PhotoSlot({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="card border-dashed flex flex-col items-center justify-center gap-1 aspect-square cursor-pointer">
      <Icon className="w-5 h-5 text-[var(--text-secondary)]" />
      <span className="text-[10px] text-[var(--text-secondary)]">{label}</span>
    </div>
  );
}

function MiniStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="rounded-md p-2 text-center"
      style={{
        background: highlight ? "#EAF3DE" : "var(--bg-page)",
      }}
    >
      <p
        className="text-[11px]"
        style={{ color: highlight ? "#3B6D11" : "var(--text-secondary)" }}
      >
        {label}
      </p>
      <p
        className="text-sm font-medium"
        style={{ color: highlight ? "#3B6D11" : "var(--text-primary)" }}
      >
        {value}
      </p>
    </div>
  );
}
