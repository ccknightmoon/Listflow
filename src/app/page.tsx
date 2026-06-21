import Link from "next/link";
import { Camera, Zap, Tag, TrendingUp } from "lucide-react";

export default function SplashPage() {
  return (
    <main className="min-h-screen flex flex-col px-6 pt-16 pb-12 max-w-sm mx-auto">
      {/* Logo */}
      <div className="flex flex-col items-center text-center mb-12">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
          style={{ background: "#185FA5" }}
        >
          <span className="text-white font-bold text-xl tracking-tight">LF</span>
        </div>
        <h1 className="text-3xl font-semibold mb-2">Listflow</h1>
        <p className="text-[var(--text-secondary)] text-base leading-relaxed">
          Snap photos of thrifted items.<br />
          AI writes the listing. Post to eBay in seconds.
        </p>
      </div>

      {/* Feature pills */}
      <div className="flex flex-col gap-3 mb-12">
        <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "#F0F7FF" }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#185FA5" }}>
            <Camera className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium">Photo to listing</p>
            <p className="text-xs text-[var(--text-secondary)]">AI detects brand, size, condition automatically</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "#F0F7FF" }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#185FA5" }}>
            <Tag className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium">Live eBay pricing</p>
            <p className="text-xs text-[var(--text-secondary)]">Suggests prices based on what's selling right now</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "#F0F7FF" }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#185FA5" }}>
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium">One-tap posting</p>
            <p className="text-xs text-[var(--text-secondary)]">Fills all eBay item specifics for better search visibility</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "#F0F7FF" }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#185FA5" }}>
            <TrendingUp className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium">Track your store</p>
            <p className="text-xs text-[var(--text-secondary)]">Manage listings, view sales history, update prices</p>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="flex flex-col gap-3">
        <Link href="/login" className="btn btn-primary w-full text-center py-3">
          Get started
        </Link>
        <Link href="/login" className="btn w-full text-center py-3 text-[var(--text-secondary)]">
          Sign in
        </Link>
      </div>
    </main>
  );
}
