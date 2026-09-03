import { Sparkles } from "lucide-react";

export default function AIDisclaimer({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-page)] px-3 py-2 text-xs text-[var(--text-secondary)] ${className}`.trim()}
    >
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
      <p>
        AI suggestions may be imperfect. Review the title, condition, price, and item details before listing.
      </p>
    </div>
  );
}
