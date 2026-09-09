# Backlog — things to do later

This is a plain-English list of stuff we know needs work but can't do yet, and why. No code talk. For the technical version, see CLAUDE.md's "Deferred" section.

Every time something gets pushed to later, it gets added here too.

---

## Shipping labels in the app

You'd have to buy the shipping label somewhere else for now (eBay's own site/app, PayPal, PirateShip, etc).

Why: eBay requires special permission before any outside app can let you buy a label directly through it. That permission has to be requested from eBay and approved by them — nothing here can request or check that automatically.

Fix later: request access from eBay when we're ready, then build it once approved.

---

## Leaked password protection

Not turned on yet.

Why: it costs $25/month (Supabase's Pro plan). Not worth paying while it's just you using the app.

Fix later: turn it on once other people start using the app with their own passwords.

---

## Returns/refunds tracking

Not built yet.

Why: eBay's instructions for handling buyer returns inside an app aren't clear enough to build against safely — even eBay's own help forums don't agree on what's needed.

Fix later: needs clearer docs from eBay, or a real return to test against.

---

## Smarter stale-listing flags (watch count)

Right now a listing is flagged "stale" only based on how many days it's been active with no sale.

Why not more: adding "how many people are watching it" would make the flag smarter, but that needs a bigger, untested request to eBay that could slow the page down. Didn't want to ship it half-checked.

Fix later: test the bigger request for speed, then add watch count into the stale flag.

---

## Buyer questions — needs a real test

The buyer-questions feature (view and reply to questions in the app) is built and passes all our checks, but hasn't been tried on a real question from a real buyer yet — there was no way to create one to test with from here.

Fix later: try it next time a real buyer question comes in, and let us know if anything looks off.
