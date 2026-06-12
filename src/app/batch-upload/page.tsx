import Link from "next/link";
import { ArrowLeft, CloudUpload, Shirt, Check } from "lucide-react";
import BottomNav from "@/components/BottomNav";

const groups = [
  { label: "Item 1 · 4 photos grouped" },
  { label: "Item 2 · 3 photos grouped" },
  { label: "Item 3 · 5 photos grouped" },
];

export default function BatchUploadPage() {
  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-medium">Batch upload</h1>
      </div>

      <div className="card border-dashed text-center py-10 mb-6">
        <CloudUpload className="w-7 h-7 mx-auto text-[var(--text-secondary)] mb-2" />
        <p className="text-sm text-[var(--text-secondary)]">
          Drop photo folders here
          <br />
          AI groups shots by item automatically
        </p>
      </div>

      <div className="flex flex-col gap-2 mb-6">
        {groups.map((g) => (
          <div key={g.label} className="card flex items-center gap-3 p-3">
            <Shirt className="w-4 h-4 text-[var(--text-secondary)]" />
            <p className="text-sm flex-1">{g.label}</p>
            <Check className="w-4 h-4" style={{ color: "#3B6D11" }} />
          </div>
        ))}
      </div>

      <button className="btn btn-primary w-full">Generate all listings</button>

      <BottomNav />
    </main>
  );
}
