# Listing accuracy benchmark (repeatable)

Runs on the deployed app, because the OpenAI key and the eBay connection only exist there.

1. Sign in to Listflow as Sel and open **/benchmark** (e.g. https://listflow-two.vercel.app/benchmark).
2. Choose how many listings to test (default 40, max 60). Leave the model blank for the app default (`gpt-4o-mini`), or type e.g. `gpt-4o` to compare a stronger model.
3. Click **Run benchmark**. It samples Sel's active listings evenly, reads each one (title, category, item specifics, photos) and runs the same AI pipeline as Batch Upload on its photos.
   - **Read-only:** nothing is listed, edited or ended.
   - Each listing costs one vision call plus one text call. These are not counted against the monthly AI cap.
4. Read the summary:
   - category match (exact, and same branch)
   - field accuracy (Brand, Size, Color, Type, Department, Team, Player, Material, Sleeve Length, Country)
   - required specifics complete
   - title quality
   - % marked Ready, and how often the "Ready" items were actually right

   **Download results** saves a JSON file so runs can be compared (before/after a change, or one model against another).

APIs: `GET /api/benchmark/sample?n=40` returns listing ids; `POST /api/benchmark/run {itemId, model?}` returns one scored item. Scoring is in `src/lib/benchmark.ts` (unit-tested).

Caveat: Sel's own listings are the "gold" answer. A field Sel left blank counts as "extra", not wrong, and Sel's own mistakes count against the AI.
