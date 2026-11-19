# Accurate listings at the source (Nov 2026, branch feat/accurate-listings)

Goal: upload photos → List. Validation stays as the safety net; this makes the AI right in the first place.

| # | Change | Impact | Risk |
|---|---|---|---|
| 1 | **Pass A, evidence extraction** (vision): OCR every tag (brand, size, RN, fiber %, Made in, care, date code, style no.), printed text and graphics, tape measurements and flaws, each with its source. | High: most errors come from guessed brand, size or material. | Low: same call, richer output. |
| 2 | **Category first, then Pass B, constrained fill** (text): the category's real aspect schema goes to the model as a JSON schema (enums for selection-only, arrays for multi-value, every field nullable). It can only answer valid aspects and values, and only from Pass A facts. | High: removes invalid values at the source. | Low: enum limits handled (big lists become plain strings, validated after). |
| 3 | **SEO title** built from the validated specifics in buyer-search order (Brand, Vintage/era if evidenced, descriptors, item type, features, size, color). It never contradicts the specifics. No caps-lock, no filler, no repeats. | High for sales. | Low. |
| 4 | **Confidence gate**: each item gets a score with reasons → **Ready** / **Needs a look**, with the exact fields named. Batch gets "List all Ready". | High: one tap for the easy ones. | Medium (UI): additive. |
| 5 | **Benchmark** on Sel's own live listings (read-only): category, required specifics, field accuracy, title quality. A repeatable page plus an API on the deployed app (the OpenAI and eBay keys only exist there). | Measures everything above. | Low: read-only, never publishes. |
| – | Model is configurable (`OPENAI_VISION_MODEL`, default unchanged `gpt-4o-mini`), so a stronger model can be A/B tested on the benchmark before switching. | – | None by default. |

Deferred (not low-risk enough now): Browse API keyword weighting for titles.
