# Listflow

AI-powered listing assistant for eBay resellers — upload photos, get AI pricing
suggestions, and post directly to eBay.

## What's here

A working Next.js app with all core screens:

- `/` — splash / landing page
- `/login` — sign in (not yet wired to real auth)
- `/dashboard` — home screen with stats and quick actions
- `/new-listing` — photo upload + AI pricing (mock pricing logic for now)
- `/drafts` — review and bulk-post drafts
- `/batch-upload` — batch photo upload flow
- `/membership` — pricing plans (Pro highlighted as recommended)

Pricing logic lives in `src/lib/pricing.ts` — currently mock data, designed to
be swapped for real API calls without changing the UI.

## Running locally

You'll need Node.js 18+ installed.

```bash
npm install
npm run dev
```

Then open http://localhost:3000

## Deploying (free)

1. Push this folder to a new GitHub repository.
2. Go to https://vercel.com, sign in with GitHub.
3. Click "New Project", select your repo, click Deploy.
4. You'll get a live URL (e.g. listflow.vercel.app) in about a minute.

Every time you push changes to GitHub, Vercel redeploys automatically.

## Roadmap to a fully working product

### 1. Database + user accounts (do this first)
- Create a free account at https://supabase.com
- Create a new project, get your project URL and anon key
- Add `@supabase/supabase-js` and wire up auth on `/login`
- Tables you'll need: `users`, `listings`, `subscriptions`

### 2. Payments / membership billing
- Create a free account at https://stripe.com
- Set up three Products matching the plans on `/membership` (Starter, Pro,
  Power seller)
- Use Stripe Checkout for subscription signups
- Use Stripe webhooks to update each user's plan in Supabase

### 3. Real photo upload + storage
- Use Supabase Storage (or AWS S3 / Cloudflare R2) for photo uploads
- Replace the photo slot placeholders in `/new-listing` and `/batch-upload`
  with a real file input + upload to storage

### 4. AI image analysis
- Get an Anthropic API key at https://console.anthropic.com
- Send uploaded photos to Claude's vision API to detect: item type, brand,
  size, color, condition, and visible flaws
- Use the result to auto-fill the listing title and condition fields

### 5. Real pricing data (eBay APIs)
- Apply for an eBay Developer account at https://developer.ebay.com
- Apply for production access to:
  - **Browse API** — active listings (faster approval)
  - **Marketplace Insights API** — sold listing history (requires approval,
    can take 1-3 weeks — apply early)
- Replace `getPriceSuggestion()` in `src/lib/pricing.ts` with real calls to
  these APIs, keeping the same return shape

### 6. eBay listing creation
- Once you have eBay API access, use the **Inventory API** (or Trading API)
  to create draft listings and publish them directly from `/drafts`
- Requires OAuth — users connect their eBay seller account from a settings
  page

## Suggested order of work

1. Supabase auth + database (unlocks real user accounts)
2. Stripe billing (unlocks the membership model)
3. Photo upload to storage
4. Claude vision for item detection
5. eBay Browse API for active listing prices (apply for Marketplace Insights
   in parallel, since approval takes longest)
6. eBay Inventory API for posting listings

Each step works independently — you can ship and use the app for personal
listing before billing/membership is fully wired up.
