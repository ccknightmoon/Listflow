import Link from "next/link";
import { ArrowLeft, Shirt, ChevronRight } from "lucide-react";
import BottomNav from "@/components/BottomNav";

const drafts = [
  { title: "Levi's 501 jeans, 32x32", price: 32, odds: "High" },
  { title: "Patagonia fleece vest, M", price: 44, odds: "Medium" },
  { title: "Carhartt work jacket, XL", price: 58, odds: "High" },
];

export default function DraftsPage() {
  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-medium">Drafts ({drafts.length})</h1>
      </div>

      <div className="flex flex-col gap-2 mb-6">
        {drafts.map((d) => (
          <div key={d.title} className="card flex items-center gap-3 p-3">
            <div className="w-9 h-9 rounded-md bg-[var(--bg-page)] flex items-center justify-center">
              <Shirt className="w-4 h-4 text-[var(--text-secondary)]" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">{d.title}</p>
              <p className="text-xs text-[var(--text-secondary)]">
                Suggested ${d.price} · {d.odds} sell odds
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)]" />
          </div>
        ))}
      </div>

      <button className="btn btn-primary w-full">List all to eBay</button>

      <BottomNav />
    </main>
  );
}
