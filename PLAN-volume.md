# Listflow at volume: 50 items / ~450 photos a day (plan only, nothing built)

**Goal:** shoot all day, and by the time Sel sits down every item is already a draft. Most are marked **Ready**, Sel reviews in seconds each, taps **List all Ready**, and publishing finishes in the background with the phone closed.

**Timings below are estimates from the code.** They haven't been measured on Sel's phone yet; Phase 0 adds the measurements.

---

## 1. Today, for a 50-item / 450-photo day (estimated)

| Stage | How it works now | Estimate |
|---|---|---|
| Pick photos and compress | Browser resizes each photo to 1024 px, one after another. **Max 200 per batch**, so 3 separate batches. | ~1–2 min, plus doing it 3 times |
| Grouping | AI, **15 photos per call, strictly one call after another** (each needs the last one's ending) → ~30 calls. Zero calls if ✂ / "New item starts here" markers are used. | **~4–6 min** (biggest machine wait) |
| Analysis | Per item: vision call (first 6 photos only) + category/aspect lookup + Pass B fill + price comps. **3 at a time**, and only while the page is open. | ~20 s/item → **~6 min** |
| Category / aspect lookups | Cached in memory for 12 h per server instance; a fresh instance has to look them up again. | small (~1–2 s per new category) |
| Draft save | Uploads 6–10 photos per item to storage, then saves the row; 3–5 at a time. Uploads start only at save. | ~2–3 min (more on slow LTE) |
| Review | One long scrolling card per item; "List all Ready" helps. | **~30–60 s/item → 25–50 min (the biggest overall cost)** |
| Publish | Runs in the **browser**, 2 at a time, ~5–10 s each. Pauses if the app is closed. | ~3–4 min, phone must stay open |

**Bottlenecks, in order:**
1. Human review time.
2. Grouping that runs one call at a time.
3. Analysis and publishing only run while the phone is on the page.
4. The 200-photo cap (3 batches).
5. Only the first 6 photos are analyzed. With 8–10 photos per item, the size and care **tags are often photos 7–10 and never get read**. That hurts accuracy, which in turn means more review.

**AI cap:** 3,000 counted calls a month. A day of 50 items counts about 80 (≈30 grouping + 50 analysis), so the cap runs out in roughly 3–5 weeks at that pace, sooner with re-analyses and single listings.

## 2. Fastest reliable design

**a) Groups known while shooting: zero AI grouping by default**
- **Batch camera** in the app: shoot item 1, tap **Next item**, shoot item 2, and so on. Groups are exact and instant. This is the recommended way.
- **Camera-roll uploads:** group by when each photo was taken (photo timestamps). A pause of more than ~25–40 s between shots usually means a new item. AI is asked only about the few unclear gaps, and those calls can run in parallel because each one is independent.
- Keep ✂ (SKU shot) and divider-shot detection as they are.

**b) Upload while shooting.** Each photo is compressed and uploaded in the background as soon as it's taken or picked (4 at a time, with retries). By the time Sel taps "Analyze", the photos are already on the server.

**c) Server-side job queue: works with the phone closed**
- Each item becomes a job in Supabase; the `batch_jobs` table already exists.
- A server worker processes jobs 6–10 at a time and writes each draft as it finishes. The app just shows drafts appearing.
- **Free option (recommended first):** a Vercel function that handles a few items per run (under 60 s) and then hands the rest to a fresh run of itself, with an hourly backup sweep that picks up anything stuck. This stays on the free plan.
- **Hosted queue options:** QStash (Upstash) or Inngest, both with free tiers; check their current limits before choosing.
- **Vercel Pro (~$20/month):** longer functions and more frequent scheduled jobs. Nice to have, not required.

**d) No 200-photo cap.** Accept 500+ photos in one go, processed in chunks behind the scenes.

**e) Smarter photo choice for analysis.** Send all of an item's photos: front, back and tag shots at full detail, the rest at low detail (cheap). Tags are always read. This is the biggest accuracy gain for 8–10-photo items.

**f) Caching.** Save eBay's field lists and category lookups in a Supabase table (a 1-day copy), so a cold server never has to look them up again.

**g) Fast review**
- A **Ready queue**: one card per screen showing the photo, title, price and **only the flagged fields**.
- Swipe right to approve, left to fix; arrow keys / Enter on a computer.
- **List all Ready** stays.
- Prices are always auto-filled from the comps, so Ready means truly listable.

**h) Publishing on the server**, through the same job queue (one at a time per item, never published twice). The tray shows progress, and nothing stops if Sel leaves.

**i) AI cap and cost.** Raise the monthly cap to ~10,000 counted calls, with a daily safety limit (e.g. 600) and a spend alert. Estimated OpenAI cost per item (from published per-token prices; please confirm against OpenAI's current pricing page):

| Per item (≈6 full-detail + 4 low-detail photos + 1 text pass) | gpt-4o-mini | gpt-4o |
|---|---|---|
| Photos | ~$0.02–0.03 (mini charges more for image tokens) | ~$0.012–0.02 |
| Text (output + Pass B) | ~$0.002 | ~$0.02 |
| **≈ per item** | **~$0.025–0.035** | **~$0.03–0.04** |
| 50 items/day, for a month | **~$40–55** | **~$45–60** |

For photo-heavy items the two models cost about the same, and gpt-4o likely reads tags better. **Decide with the benchmark**, not by guess. Grouping by time gaps also removes most of the grouping cost (~$0.50 a day today).

## 3. Targets

- **50 items drafted within ~5 minutes of the last photo uploading.** Analysis runs while Sel is still shooting.
- **Review:** ~10 s per Ready item and ~40 s per flagged item. With ~70% Ready, that's **~15 minutes for 50 items** (vs 25–50 min today).
- **Publish:** all 50 within ~5 minutes, in the background, phone can be closed.
- **AI cap never hit** at 50/day.

## 4. Build order (quick wins first)

| Phase | What | Effort | Risk | How it's verified |
|---|---|---|---|---|
| 0 | Timing per stage (log + "this batch took…") | S | Low | Real 50-item batch; numbers in the report |
| 1 | Photo choice: all photos, tags at full detail | S | Low | Benchmark: size/brand/material accuracy before vs after |
| 1 | Analysis 3 → 6 at a time (watch OpenAI rate limits), lift the 200 cap with chunking | S | Low–Med | 450-photo test batch: no errors from OpenAI's rate limits, time halves |
| 1 | Raise the AI cap to ~10k plus a daily limit and spend alert | S | Low | Settings shows usage; alert fires in a test |
| 1 | Upload in the background as photos are picked | M | Low | Save time ≈ 0 after picking |
| 2 | Time-gap grouping for camera-roll uploads (AI only for unclear gaps) | M | Med | Sel's real days: grouping accuracy vs today, fewer AI calls |
| 2 | In-app batch camera with **Next item** | M | Low | Grouping 100% correct; 0 grouping calls |
| 3 | Server job queue for analysis (free self-chaining worker, then QStash/Pro if needed) | L | Med | Close the phone mid-batch → all drafts still appear; nothing processed twice |
| 3 | Server-side publishing on the same queue | M | Med | Publish 50 with the phone closed; no double listings |
| 4 | Ready-queue review (one card, flagged fields only, swipe/keys) | M | Low | Timed review: seconds per item before/after |
| 4 | Saved copy of category lookups in Supabase | S | Low | Cold-start lookups disappear from the timings |

**Main risks:**
- OpenAI rate limits at higher parallelism. Mitigation: backoff and an adjustable concurrency setting.
- Time-gap grouping mistakes (e.g. Sel re-shoots a tag later). Mitigation: unclear gaps go to AI, plus easy merge/split in review.
- The server queue running an item twice. Mitigation: each job is claimed by one worker only, and publishing already refuses to publish the same draft twice.
- Cost creep. Mitigation: the daily limit plus the spend alert.
