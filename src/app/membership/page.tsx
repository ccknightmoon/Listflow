import Link from "next/link";
import { ArrowLeft, Feather, Rocket, Building2, Check, X } from "lucide-react";
import BottomNav from "@/components/BottomNav";

export default function MembershipPage() {
  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-medium">Choose your plan</h1>
      </div>

      <p className="text-sm text-[var(--text-secondary)] mb-6">
        Cancel anytime. 7-day free trial on all plans.
      </p>

      <div className="flex flex-col gap-4">
        <PlanCard
          icon={Feather}
          name="Starter"
          price="$0"
          features={[
            { label: "10 listings / month", included: true },
            { label: "AI price suggestions", included: true },
            { label: "Batch upload", included: false },
            { label: "Direct eBay posting", included: false },
          ]}
          cta="Start free"
        />

        <PlanCard
          icon={Rocket}
          name="Pro"
          price="$29"
          period="/mo"
          badge="Most successful"
          highlighted
          features={[
            { label: "Unlimited listings", included: true },
            { label: "AI pricing + sell-odds", included: true },
            { label: "Batch photo upload", included: true },
            { label: "Direct eBay posting", included: true },
          ]}
          cta="Start free trial"
        />

        <PlanCard
          icon={Building2}
          name="Power seller"
          price="$59"
          period="/mo"
          features={[
            { label: "Everything in Pro", included: true },
            { label: "Multi-account support", included: true },
            { label: "Bulk re-pricing tool", included: true },
            { label: "Priority support", included: true },
          ]}
          cta="Upgrade"
        />
      </div>

      <BottomNav />
    </main>
  );
}

interface Feature {
  label: string;
  included: boolean;
}

function PlanCard({
  icon: Icon,
  name,
  price,
  period,
  badge,
  highlighted,
  features,
  cta,
}: {
  icon: React.ElementType;
  name: string;
  price: string;
  period?: string;
  badge?: string;
  highlighted?: boolean;
  features: Feature[];
  cta: string;
}) {
  return (
    <div
      className="card p-5 relative"
      style={
        highlighted
          ? { border: "2px solid #378ADD" }
          : undefined
      }
    >
      {badge && (
        <div
          className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-xs px-3 py-1 rounded-md whitespace-nowrap"
          style={{ background: "#E6F1FB", color: "#0C447C" }}
        >
          {badge}
        </div>
      )}

      <Icon
        className="w-5 h-5"
        style={{ color: highlighted ? "#185FA5" : "var(--text-secondary)", marginTop: badge ? 8 : 0 }}
      />
      <h3 className="text-base font-medium mt-3">{name}</h3>
      <p className="text-2xl font-medium mt-1 mb-3">
        {price}
        {period && (
          <span className="text-sm text-[var(--text-secondary)] font-normal">
            {period}
          </span>
        )}
      </p>

      <div className="flex flex-col gap-2 mb-5">
        {features.map((f) => (
          <p
            key={f.label}
            className="text-sm flex items-center gap-2"
            style={{
              color: f.included ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            {f.included ? (
              <Check className="w-3.5 h-3.5" style={{ color: "#3B6D11" }} />
            ) : (
              <X className="w-3.5 h-3.5" />
            )}
            {f.label}
          </p>
        ))}
      </div>

      <button className={highlighted ? "btn btn-primary w-full" : "btn w-full"}>
        {cta}
      </button>
    </div>
  );
}
