import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { parsePrivatePhotoRef, PRIVATE_BUCKET } from "@/lib/private-photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_S = 3600;

// Private draft photo (src/lib/private-photos.ts): only the owner, signed in,
// gets redirected to a short-lived signed URL. The browser caches the
// redirect privately for a little under the link's lifetime.
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string; file: string }> }) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { userId, file } = await params;
  const ref = parsePrivatePhotoRef(`/api/photos/${userId}/${file}`);
  if (!ref || ref.userId !== auth.user.id.toLowerCase()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data, error } = await auth.supabase.storage.from(PRIVATE_BUCKET).createSignedUrl(ref.path, TTL_S);
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "Cache-Control": `private, max-age=${TTL_S - 300}` } });
}
