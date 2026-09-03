import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Real Terms of Service, replacing the earlier four-paragraph placeholder.
// Drafted from comparative research into how other resale/listing platforms
// (eBay, Poshmark, Mercari, Vinted, Vendoo, Crosslist) structure these
// clauses -- see the "Listflow Legal Ledger" reference doc for sourcing and
// the reasoning behind each section. This is NOT attorney-drafted language;
// have a Florida-licensed attorney review before treating it as binding,
// especially the liability/indemnification sections.
const EFFECTIVE_DATE = "September 3, 2026";
const CONTACT_EMAIL = "funkyvaultvintage+listflow@gmail.com";
const VENUE_COUNTY = "Miami-Dade County, Florida";

export default function TermsPage() {
  return (
    <main className="min-h-screen max-w-md mx-auto px-5 py-8 text-[var(--text-primary)]">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] mb-4">
        <ArrowLeft className="w-4 h-4" /> Back
      </Link>
      <h1 className="text-2xl font-semibold mb-1">Terms of Service</h1>
      <p className="text-xs text-[var(--text-tertiary)] mb-6">Effective {EFFECTIVE_DATE}</p>

      <div className="space-y-6 text-sm text-[var(--text-secondary)] leading-6">
        <p>
          Listflow (“we,” “us,” “the Service”) is a personal listing tool operated by an individual doing
          business in Florida, not a registered company. These Terms govern your use of Listflow. By signing in
          or using the Service, you agree to them.
        </p>

        <Section title="1. AI-generated suggestions are not guaranteed accurate">
          <p>
            Listflow uses an AI model to suggest item titles, descriptions, conditions, categories, and prices
            based on the photos you upload. These are suggestions only, generated automatically without human
            review by us, and are provided for your convenience.
          </p>
          <p>
            They are not guaranteed to be accurate, complete, current, or optimal for your item. Before
            publishing any listing, you are solely responsible for reviewing, correcting, and verifying every
            AI-suggested title, description, condition, category, and price. We are not liable for losses,
            disputes, or platform actions (including eBay “item not as described” claims) that result from
            publishing an AI suggestion without independently checking it first.
          </p>
        </Section>

        <Section title="2. Who can use Listflow">
          <p>You must be at least 18 years old, or the age of legal majority in your jurisdiction, to use the Service.</p>
        </Section>

        <Section title="3. Your responsibilities">
          <p>
            You are responsible for the accuracy of everything you publish through Listflow, for complying with
            eBay’s own policies (including its Prohibited and Restricted Items policy and User Agreement), and
            for your applicable tax and shipping obligations.
          </p>
          <p>
            You may not use Listflow to create listings for counterfeit, stolen, recalled, or illegal items. Any
            claim of authenticity or brand affiliation in your listings is your own representation, not ours —
            Listflow’s AI suggestions are not an authentication service and must never be represented as one.
          </p>
        </Section>

        <Section title="4. Account termination">
          <p>
            We may suspend or terminate your access to the Service at any time, for any reason, including a
            violation of these Terms, with or without notice. You may also delete your own account at any time —
            see the Privacy Policy for how that works.
          </p>
        </Section>

        <Section title="5. No warranty">
          <p>
            THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE,” WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
            IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT
            WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE.
          </p>
        </Section>

        <Section title="6. Limitation of liability">
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY FOR ANY CLAIM ARISING FROM YOUR USE OF
            THE SERVICE WILL NOT EXCEED $100. WE ARE NOT LIABLE FOR INDIRECT, INCIDENTAL, CONSEQUENTIAL,
            SPECIAL, OR PUNITIVE DAMAGES, OR LOST PROFITS, EVEN IF ADVISED OF THE POSSIBILITY.
          </p>
        </Section>

        <Section title="7. Indemnification">
          <p>
            You agree to indemnify, defend, and hold us harmless from any claims, damages, losses, and expenses
            (including reasonable attorneys’ fees) arising from: (a) content or listings you create through the
            Service, (b) your use or misuse of the Service, (c) your violation of these Terms, or (d) your
            violation of any law or third party’s rights, including intellectual property rights or eBay’s own
            seller policies.
          </p>
        </Section>

        <Section title="8. Governing law">
          <p>
            These Terms are governed by the laws of the State of Florida, without regard to its conflict-of-laws
            principles. Any dispute not resolved informally will be brought in the state or federal courts
            located in {VENUE_COUNTY}.
          </p>
        </Section>

        <Section title="9. Changes to these terms">
          <p>
            We may update the Service or these Terms over time. Continued use of the app after changes means you
            accept the updated Terms.
          </p>
        </Section>

        <Section title="10. Contact">
          <p>
            Questions about these Terms? Contact <a href={`mailto:${CONTACT_EMAIL}`} className="underline">{CONTACT_EMAIL}</a>.
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
