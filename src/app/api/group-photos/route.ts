import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { checkAndConsumeAiUsage, AI_USAGE_LIMIT_MESSAGE } from "@/lib/ai-usage";
import { groupPhotosCore, type GroupImagePart } from "@/lib/group-photos-core";

export const runtime = "nodejs";


export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  let body: { images?: { data: string; mediaType: string }[] };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const images = body.images ?? [];

  if (images.length === 0) {
    return NextResponse.json(
      { error: "At least one image is required." },
      { status: 400 }
    );
  }

  const usage = await checkAndConsumeAiUsage(auth.user.id, 1);
  if (!usage.allowed) {
    return NextResponse.json({ error: usage.message || AI_USAGE_LIMIT_MESSAGE }, { status: 429 });
  }

  // Standard (not "low") detail — grouping decisions and the downstream
  // analysis both depend on being able to actually read tags/measurements
  // in these photos, and low-detail tiles make that materially worse. This
  // is the bulk path, so getting it right here matters more, not less.
  const parts: GroupImagePart[] = images.map((img) => ({
    type: "image_url",
    image_url: { url: `data:${img.mediaType};base64,${img.data}` },
  }));

  try {
    return NextResponse.json(await groupPhotosCore(apiKey, parts));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
