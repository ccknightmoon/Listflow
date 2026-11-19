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
