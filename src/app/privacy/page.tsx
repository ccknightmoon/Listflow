import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Real Privacy Policy, replacing the earlier four-paragraph placeholder.
// eBay's Developer API License Agreement (section 8.2) requires apps using
// its API to publish a privacy policy consistent with eBay's own -- this
// isn't just user-facing polish, it's part of staying compliant with the
// terms Listflow's own eBay API access depends on. See the "Listflow Legal
// Ledger" reference doc for the research and sourcing behind each section.
const EFFECTIVE_DATE = "September 3, 2026";
const CONTACT_EMAIL = "funkyvaultvintage+listflow@gmail.com";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen max-w-md mx-auto px-5 py-8 text-[var(--text-primary)]">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] mb-4">
        <ArrowLeft className="w-4 h-4" /> Back
      </Link>
      <h1 className="text-2xl font-semibold mb-1">Privacy Policy</h1>
      <p className="text-xs text-[var(--text-tertiary)] mb-6">Effective {EFFECTIVE_DATE}</p>

      <div className="space-y-6 text-sm text-[var(--text-secondary)] leading-6">
        <p>
          Listflow helps you organize, price, and list items for sale on eBay. This page explains what
          information we collect, how we use it, and who we share it with.
        </p>

        <Section title="1. Information we collect">
          <p>
            Account details (email, encrypted password, managed by our authentication provider), photos you
            upload of items, draft listing data (titles, prices, conditions, descriptions), and — once you
            connect your eBay account — your eBay listing and order data.
          </p>
        </Section>

        <Section title="2. How we use it">
          <p>
            To generate listing suggestions, estimate pricing, save your drafts, and publish listings to eBay on
            your behalf. We do not use your data for advertising, and we do not sell your personal information.
          </p>
        </Section>

        <Section title="3. Who we share it with">
          <p>We share information with the following service providers, each acting on our behalf:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><b className="text-[var(--text-primary)]">Supabase</b> — account authentication, database, and photo storage.</li>
            <li><b className="text-[var(--text-primary)]">OpenAI</b> — photos you upload are sent to OpenAI’s API to generate listing suggestions. OpenAI does not use API data to train its models by default, and retains it briefly (about 30 days) for abuse-monitoring purposes.</li>
            <li><b className="text-[var(--text-primary)]">eBay</b> — once you connect your eBay account, we exchange listing and order data with eBay’s APIs on your behalf. eBay’s own Privacy Notice governs eBay’s use of that data.</li>
            <li><b className="text-[var(--text-primary)]">Vercel</b> — hosting infrastructure.</li>
          </ul>
        </Section>

        <Section title="4. Cookies">
          <p>
            We use one necessary cookie to remember your light/dark/system appearance preference. We do not use
            advertising or third-party tracking cookies.
          </p>
        </Section>

        <Section title="5. Data retention & deleting your account">
          <p>
            You can delete your account at any time from Settings → Account → Delete account. Doing so starts a
            30-day grace period: your data is not immediately erased. You can restore full access by logging
            back in and choosing “Reactivate” any time before the 30 days are up. After 30 days, your drafts,
            photos, eBay connection, and settings are permanently deleted from our systems.
          </p>
        </Section>

        <Section title="6. Your rights">
          <p>
            You may access, correct, or delete your personal information at any time through Settings, or by
            contacting us below. We will respond to any request within 30 days.
          </p>
        </Section>

        <Section title="7. Children's privacy">
          <p>
            Listflow is not directed to children under 13, and we do not knowingly collect personal information
            from anyone under 13. If we learn we have, we will delete it promptly.
          </p>
        </Section>

        <Section title="8. Changes to this policy">
          <p>We may update this policy over time. Continued use of the app after changes means you accept the update.</p>
        </Section>

        <Section title="9. Contact">
          <p>
            Questions about this policy or your data? Contact <a href={`mailto:${CONTACT_EMAIL}`} className="underline">{CONTACT_EMAIL}</a>.
          </p>
        </Section>

        <p className="text-xs text-[var(--text-tertiary)] pt-2 border-t" style={{ borderColor: "var(--border)" }}>
          This page is informational and was drafted from comparative research, not by an attorney. It is not a
          substitute for legal advice.
        </p>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-2">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
