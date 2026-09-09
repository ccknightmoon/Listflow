import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-service";
import { decryptToken } from "@/lib/ebay-token-crypto";
import { ebayContext, type EbayConnectionContext } from "@/lib/ebay-request-context";
import { fetchAllOfListType, isListTypeError, toListing } from "@/lib/ebay-listings";
import { isStale } from "@/lib/stale-listings";
import { fetchUnshippedOrders } from "@/lib/ebay-ship-orders";
import { fetchPendingOffers } from "@/lib/ebay-offers";
import { fetchUnansweredQuestions } from "@/lib/ebay-messages";
import { sendDigestEmail } from "@/lib/email";

export const runtime = "nodejs";

// Vercel Cron (see vercel.json) fires this once every hour, not once a
// day -- Sel asked for the send time to be customizable per account
// (Settings -> "Email alerts"), and this app has no per-user job scheduler,
// so the simplest correct way to honor an arbitrary chosen hour is to wake
// up every hour and check "is it this user's hour right now," same idea as
// a cron-based reminder app. notification_email_last_sent_at (migration
// 019) stops a user from being emailed twice if their hour is somehow
// checked more than once in the same ~day (a duplicate cron trigger, a
// manual test run, a repeated local hour across a DST fallback).
function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

interface CandidateUser {
  userId: string;
  connection: EbayConnectionContext;
  hourUtc: number;
  lastSentAt: string | null;
}

async function countsForUser(): Promise<{ shipCount: number; offersCount: number; questionsCount: number; staleCount: number; warnings: string[] }> {
  const warnings: string[] = [];

  const [shipResult, offersResult, questionsResult, storeResult] = await Promise.all([
    fetchUnshippedOrders(),
    fetchPendingOffers(),
    fetchUnansweredQuestions(),
    fetchAllOfListType("ActiveList"),
  ]);

  const shipCount = shipResult.error ? 0 : shipResult.items.length;
  if (shipResult.error) warnings.push(`ship: ${shipResult.error}`);

  const offersCount = "error" in offersResult ? 0 : offersResult.offers.length;
  if ("error" in offersResult) warnings.push(`offers: ${offersResult.error}`);

  const questionsCount = questionsResult.error ? 0 : questionsResult.questions.length;
  if (questionsResult.error) warnings.push(`questions: ${questionsResult.error}`);

  let staleCount = 0;
  if (isListTypeError(storeResult)) {
    warnings.push(`store: ${storeResult.error}`);
  } else {
    staleCount = storeResult.items
      .map((item) => toListing(item, "active"))
      .filter((l) => isStale(l.startTime)).length;
  }

  return { shipCount, offersCount, questionsCount, staleCount, warnings };
}

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  try {
    const supabase = getServiceClient();

    const [{ data: connections, error: connError }, { data: settingsRows, error: settingsError }] = await Promise.all([
      supabase.from("ebay_connections").select("*"),
      supabase.from("app_settings").select("user_id, notification_email_enabled, notification_email_hour_utc, notification_email_last_sent_at"),
    ]);

    if (connError) return NextResponse.json({ error: connError.message }, { status: 500 });
    if (settingsError) return NextResponse.json({ error: settingsError.message }, { status: 500 });

    const settingsByUser = new Map((settingsRows ?? []).map((row) => [row.user_id, row]));
    const currentHourUtc = new Date().getUTCHours();

    const candidates: CandidateUser[] = [];
    for (const row of connections ?? []) {
      const settings = settingsByUser.get(row.user_id);
      // No app_settings row yet == the column defaults (enabled=true,
      // hour=13 UTC) haven't actually been written for this account -- err
      // toward NOT emailing an hour it never confirmed, rather than
      // guessing. A user who wants the digest just needs to open Settings
      // once (which upserts the row on first PATCH, same as every other
      // setting already works).
      if (!settings) continue;
      if (settings.notification_email_enabled === false) continue;
      if ((settings.notification_email_hour_utc ?? -1) !== currentHourUtc) continue;

      if (settings.notification_email_last_sent_at) {
        const hoursSinceLastSend = (Date.now() - new Date(settings.notification_email_last_sent_at).getTime()) / 3_600_000;
        if (hoursSinceLastSend < 20) continue;
      }

      candidates.push({
        userId: row.user_id,
        hourUtc: settings.notification_email_hour_utc,
        lastSentAt: settings.notification_email_last_sent_at,
        connection: {
          userId: row.user_id,
          ebayUserId: row.ebay_user_id,
          refreshToken: decryptToken(row.encrypted_refresh_token),
          policies: {
            shippingFreeId: row.shipping_free_policy_id,
            shippingHeavyId: row.shipping_heavy_policy_id,
            shippingCalculatedId: row.shipping_calculated_policy_id,
            returnPolicyId: row.return_policy_id,
          },
        },
      });
    }

    const results: { userId: string; sent: boolean; total?: number; error?: string; warnings?: string[] }[] = [];

    for (const candidate of candidates) {
      try {
        const { data: authUser, error: authUserError } = await supabase.auth.admin.getUserById(candidate.userId);
        const email = authUser?.user?.email;
        if (authUserError || !email) {
          results.push({ userId: candidate.userId, sent: false, error: "Could not look up this account's email address." });
          continue;
        }

        const counts = await ebayContext.run(candidate.connection, () => countsForUser());
        const total = counts.shipCount + counts.offersCount + counts.questionsCount + counts.staleCount;

        if (total === 0) {
          results.push({ userId: candidate.userId, sent: false, total: 0, warnings: counts.warnings });
          continue;
        }

        const sendResult = await sendDigestEmail({
          to: email,
          appUrl: getAppUrl(),
          shipCount: counts.shipCount,
          offersCount: counts.offersCount,
          questionsCount: counts.questionsCount,
          staleCount: counts.staleCount,
        });

        if (!sendResult.success) {
          results.push({ userId: candidate.userId, sent: false, total, error: sendResult.error, warnings: counts.warnings });
          continue;
        }

        await supabase
          .from("app_settings")
          .update({ notification_email_last_sent_at: new Date().toISOString() })
          .eq("user_id", candidate.userId);

        results.push({ userId: candidate.userId, sent: true, total, warnings: counts.warnings });
      } catch (err) {
        results.push({ userId: candidate.userId, sent: false, error: (err as Error).message });
      }
    }

    return NextResponse.json({
      hourUtc: currentHourUtc,
      connectionsChecked: connections?.length ?? 0,
      candidates: candidates.length,
      sent: results.filter((r) => r.sent).length,
      results,
    });
  } catch (err) {
    console.error("[api/cron/daily-digest] failed:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
