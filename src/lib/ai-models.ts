// Which OpenAI models Listflow uses. Default is unchanged (gpt-4o-mini).
// Set OPENAI_VISION_MODEL (e.g. "gpt-4o") in Vercel to try a stronger
// vision model; the benchmark page can compare models before switching.
export const DEFAULT_VISION_MODEL = "gpt-4o-mini";
export const DEFAULT_TEXT_MODEL = "gpt-4o-mini";

const SAFE = /^[a-z0-9][a-z0-9.\-:]{1,60}$/i;

export function visionModel(override?: string | null): string {
  const m = override || process.env.OPENAI_VISION_MODEL || DEFAULT_VISION_MODEL;
  return SAFE.test(m) ? m : DEFAULT_VISION_MODEL;
}

export function textModel(override?: string | null): string {
  const m = override || process.env.OPENAI_TEXT_MODEL || DEFAULT_TEXT_MODEL;
  return SAFE.test(m) ? m : DEFAULT_TEXT_MODEL;
}

/**
 * Stronger vision model used ONLY for hard items (Phase 1): set
 * AI_ESCALATION_MODEL (e.g. "gpt-4o") in Vercel to turn it on. Unset (the
 * default) = off. Ignored if it's the same as the normal model.
 */
export function escalationModel(env: Record<string, string | undefined> = process.env): string | null {
  const m = env.AI_ESCALATION_MODEL?.trim();
  if (!m || !SAFE.test(m)) return null;
  const normal = env.OPENAI_VISION_MODEL && SAFE.test(env.OPENAI_VISION_MODEL) ? env.OPENAI_VISION_MODEL : DEFAULT_VISION_MODEL;
  return m === normal ? null : m;
}
