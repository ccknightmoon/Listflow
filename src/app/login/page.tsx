import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="card w-full max-w-sm p-6">
        <h2 className="text-lg font-medium mb-1">Welcome to listflow</h2>
        <p className="text-sm text-[var(--text-secondary)] mb-6">
          Sign in or create an account to start listing.
        </p>

        <div className="flex flex-col gap-3 mb-4">
          <input className="input" type="email" placeholder="Email" />
          <input className="input" type="password" placeholder="Password" />
        </div>

        <Link href="/dashboard" className="btn btn-primary w-full mb-3">
          Sign in
        </Link>

        <p className="text-xs text-center text-[var(--text-tertiary)]">
          Auth is not wired up yet — this goes straight to the dashboard for now.
        </p>
      </div>
    </main>
  );
}
