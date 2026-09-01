import { AsyncLocalStorage } from "node:async_hooks";

// Carries the current request's eBay connection (decrypted token + that
// seller's own Business Policy IDs) implicitly through the async call
// chain, instead of threading a userId/token parameter through every one
// of ebay-inventory.ts's ~14 exported functions and every call site. This
// is the same primitive Next.js itself uses for cookies()/headers() — safe
// here because every eBay-touching route declares `runtime = "nodejs"`
// (this would NOT work on the Edge runtime, which isn't in use for these).
//
// The one rule every route wrapping in ebayContext.run() must follow: every
// eBay call has to happen inside that run() callback, never in a .then()
// fired after the handler already returned (a detached callback created
// outside the run() call stack won't inherit the context). All routes as
// of Phase 2 shipping await everything inline within their handler body.
export interface EbayConnectionContext {
  userId: string;
  ebayUserId: string | null;
  refreshToken: string;
  policies: {
    shippingFreeId?: string | null;
    shippingHeavyId?: string | null;
    shippingCalculatedId?: string | null;
    returnPolicyId?: string | null;
  };
}

export const ebayContext = new AsyncLocalStorage<EbayConnectionContext>();

// Deliberately throws loud instead of returning undefined/null — a route
// that forgot to call requireEbayConnection()+ebayContext.run() should fail
// immediately and obviously the first time it's exercised, not silently
// misbehave (or worse, silently reuse whatever context happened to be
// active from an unrelated concurrent request, which is the exact class of
// cross-user bug this whole context system exists to prevent).
export function getEbayContext(): EbayConnectionContext {
  const ctx = ebayContext.getStore();
  if (!ctx) {
    throw new Error(
      "getEbayContext() called with no active eBay connection context — the calling route forgot to wrap its eBay calls in ebayContext.run()."
    );
  }
  return ctx;
}
