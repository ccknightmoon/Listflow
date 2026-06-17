# Listflow

AI-powered eBay listing assistant for resellers. Snap photos of items → AI identifies the item, suggests a title and pricing → review and post to eBay.

## Tech Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 14 (App Router, TypeScript) |
| Styling | Tailwind CSS |
| Icons | Lucide React |
| AI | OpenAI GPT-4o (vision) |
| Database | Supabase (PostgreSQL) |
| Deployment | Vercel |

Environment variables required:
- `OPENAI_API_KEY` — server-side only
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## What's Built

### Pages
- `/` — Landing/splash page
- `/login` — Sign-in form (static, bypasses to dashboard)
- `/dashboard` — Stats overview (drafts, active listings, weekly revenue) + quick action cards
- `/new-listing` — Single item flow: 3-photo slots (front, measurements, flaws) → AI analysis → pricing
- `/batch-upload` — Multi-item workflow with AI photo grouping → manual review → bulk analysis → results
- `/drafts` — Draft management with thumbnails and pricing info
- `/membership` — Pricing plans (Starter free / Pro $29 / Power $59), UI only

### API Routes
- `POST /api/analyze-item` — GPT-4o vision analysis of 1–3 photos; returns item type, brand, color, size, condition, flaws, suggested title
- `POST /api/analyze-batch` — Sequential batch analysis with rate limit handling and retry logic
- `POST /api/group-photos` — AI clusters mixed uploaded photos into per-item groups (15-photo chunks)
- `GET|POST /api/drafts` — Supabase CRUD for saved drafts

### Notable Implementation Details
- Client-side image resizing before upload (max 1568px) to reduce API token cost
- Batch upload uses explicit step state machine: `upload → grouping → review → analyzing → results`
- Sequential (not parallel) batch processing to respect OpenAI rate limits; 3 retries with 15s delay on rate-limit errors
- `src/lib/pricing.ts` exports `getPriceSuggestion()` — currently returns mock data, designed to be swapped for real eBay API calls without touching UI code
- `src/lib/supabase.ts` — Supabase client
- `drafts` table stores title, brand, color, size, condition, flaws, suggested_price, avg_sold, thumbnail URL

## What's Missing

| Feature | Status | Notes |
|---|---|---|
| **Auth** | Not wired up | Login page is static; needs Supabase auth integrated |
| **Real pricing** | Mock data | Replace `getPriceSuggestion()` in `src/lib/pricing.ts` with eBay Browse API + Marketplace Insights API |
| **eBay posting** | UI only | "List on eBay" button exists; needs eBay Inventory API + OAuth flow |
| **Stripe billing** | UI only | Membership page shows plans but has no payment integration |
| **Cloud photo storage** | Not implemented | Photos are currently base64 in-memory; needs Supabase Storage, S3, or Cloudflare R2 |
