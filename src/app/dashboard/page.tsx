import Link from "next/link";
import { Plus, ImagePlus, FileText, BarChart2, ChevronRight } from "lucide-react";
import BottomNav from "@/components/BottomNav";

export default function DashboardPage() {
  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-[var(--text-secondary)]">Welcome back</p>
          <h1 className="text-xl font-medium">Alex&apos;s closet</h1>
        </div>
        <div className="w-9 h-9 rounded-full bg-brand-50 flex items-center justify-center text-brand-600 font-medium text-sm">
          A
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-6">
        <Stat label="drafts" value="12" />
        <Stat label="active" value="47" />
        <Stat label="this week" value="$612" />
      </div>

      <Link href="/new-listing" className="btn btn-primary w-full mb-6">
        <Plus className="w-4 h-4" />
        New listing
      </Link>

      <p className="text-sm text-[var(--text-secondary)] mb-2">Quick actions</p>
      <div className="flex flex-col gap-2">
        <QuickAction
          href="/batch-upload"
          icon={ImagePlus}
          title="Batch upload"
          subtitle="Add multiple items at once"
        />
        <QuickAction
          href="/drafts"
          icon={FileText}
          title="Review drafts"
          subtitle="12 ready to post"
        />
        <QuickAction
          href="/membership"
          icon={BarChart2}
          title="Pricing insights"
          subtitle="Market trends for your niche"
        />
      </div>

      <BottomNav />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3 text-center">
      <p className="text-xl font-medium">{value}</p>
      <p className="text-[11px] text-[var(--text-secondary)]">{label}</p>
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  title,
  subtitle,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  subtitle: string;
}) {
  return (
    <Link href={href} className="card flex items-center gap-3 p-3">
      <Icon className="w-5 h-5 text-[var(--text-secondary)]" />
      <div className="flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-[var(--text-secondary)]">{subtitle}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)]" />
    </Link>
  );
}
