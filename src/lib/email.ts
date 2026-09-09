import { Resend } from "resend";

// Thin wrapper around Resend's SDK -- the only caller right now is the
// daily-digest cron route (src/app/api/cron/daily-digest/route.ts).
// RESEND_API_KEY lives in Vercel's project env vars (and .env.local for
// local testing), never in source.
//
// Resend's free/sandbox tier (no verified custom domain) can only send TO
// the account's own verified email address -- fine for this app's
// single-seller-per-account case. The "from" address uses Resend's own
// onboarding@resend.dev sandbox sender, which works with no domain setup.
let client: Resend | null = null;
function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!client) client = new Resend(key);
  return client;
}

export interface DigestCounts {
  shipCount: number;
  offersCount: number;
  questionsCount: number;
  staleCount: number;
}

function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

function buildDigestText(counts: DigestCounts, appUrl: string): string {
  const lines: string[] = [];
  if (counts.shipCount > 0) {
    lines.push(`- ${counts.shipCount} ${pluralize(counts.shipCount, "order", "orders")} to ship`);
  }
  if (counts.offersCount > 0) {
    lines.push(`- ${counts.offersCount} pending ${pluralize(counts.offersCount, "offer", "offers")}`);
  }
  if (counts.questionsCount > 0) {
    lines.push(`- ${counts.questionsCount} unanswered buyer ${pluralize(counts.questionsCount, "question", "questions")}`);
  }
  if (counts.staleCount > 0) {
    lines.push(`- ${counts.staleCount} ${pluralize(counts.staleCount, "listing", "listings")} sitting 30+ days with no sale`);
  }
  return `Listflow found a few things that could use your attention today:\n\n${lines.join("\n")}\n\nOpen Listflow: ${appUrl}`;
}

// Caller (the cron route) already checks the total is > 0 before calling
// this -- kept as a defensive no-op here too rather than sending an empty
// "nothing to report" email if that check is ever skipped.
export async function sendDigestEmail(
  args: { to: string; appUrl: string } & DigestCounts
): Promise<{ success: boolean; error?: string }> {
  const resend = getClient();
  if (!resend) return { success: false, error: "RESEND_API_KEY is not configured." };

  const total = args.shipCount + args.offersCount + args.questionsCount + args.staleCount;
  if (total === 0) return { success: true };

  try {
    const { error } = await resend.emails.send({
      from: "Listflow <onboarding@resend.dev>",
      to: args.to,
      subject: `Listflow: ${total} ${pluralize(total, "thing needs", "things need")} your attention`,
      text: buildDigestText(args, args.appUrl),
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
