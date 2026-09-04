import type { getServerSupabase } from "./auth";
import { decryptToken } from "./ebay-token-crypto";
import type { EbayConnectionContext } from "./ebay-request-context";

// One Supabase query — RLS on ebay_connections (auth.uid() = user_id, see
// 004_ebay_per_user_connections.sql) means this can only ever return the
// calling user's own row, same pattern already used for app_settings.
// Returns null if this user hasn't connected eBay yet; callers turn that
// into the same {connect: true} response shape routes already returned
// when the old shared EBAY_OAUTH_REFRESH_TOKEN env var was unset.
export async function requireEbayConnection(auth: {
  supabase: Awaited<ReturnType<typeof getServerSupabase>>;
}): Promise<EbayConnectionContext | null> {
  const { data } = await auth.supabase.from("ebay_connections").select("*").maybeSingle();
  if (!data) return null;

  return {
    userId: data.user_id,
    ebayUserId: data.ebay_user_id,
    refreshToken: decryptToken(data.encrypted_refresh_token),
    policies: {
      shippingFreeId: data.shipping_free_policy_id,
      shippingHeavyId: data.shipping_heavy_policy_id,
      shippingCalculatedId: data.shipping_calculated_policy_id,
      returnPolicyId: data.return_policy_id,
    },
  };
}
