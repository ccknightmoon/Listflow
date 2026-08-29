export default function PrivacyPage() {
  return (
    <main className="min-h-screen max-w-md mx-auto px-5 py-8 text-[var(--text-primary)]">
      <h1 className="text-2xl font-semibold mb-4">Privacy Policy</h1>
      <div className="space-y-4 text-sm text-[var(--text-secondary)] leading-6">
        <p>
          Listflow helps you organize, price, and list items for sale. We collect the information needed to
          operate the app, including account details, uploaded listing photos, draft item data, and eBay listing
          metadata when you connect your eBay account.
        </p>
        <p>
          We use this information to generate listings, suggest pricing, save drafts, and support the storefront
          workflow. Photos and item details may be transmitted to third-party AI and marketplace services to
          generate listing content and pricing suggestions.
        </p>
        <p>
          We do not sell personal data. We store data securely in our hosting and database providers and retain it
          only as long as needed to provide the service and comply with legal obligations.
        </p>
        <p>
          You can request account deletion or data access by contacting the app owner or using the account
          deletion flow in the app if available.
        </p>
      </div>
    </main>
  );
}
