import Link from "next/link";
import { Layers } from "lucide-react";

export default function SplashPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center mb-4">
        <Layers className="w-8 h-8 text-brand-600" />
      </div>
      <h1 className="text-3xl font-medium mb-1">listflow</h1>
      <p className="text-[var(--text-secondary)] mb-10">list more, faster</p>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Link href="/login" className="btn btn-primary w-full">
          Get started
        </Link>
        <Link href="/dashboard" className="btn w-full">
          View demo dashboard
        </Link>
      </div>

      <p className="text-xs text-[var(--text-tertiary)] mt-6">
        Pro membership · 7-day free trial
      </p>
    </main>
  );
}
