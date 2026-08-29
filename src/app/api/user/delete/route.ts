import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

function getPhotoPath(url: string, supabaseUrl: string): string | null {
  const prefix = `${supabaseUrl}/storage/v1/object/public/photos/`;
  return url.startsWith(prefix) ? decodeURIComponent(url.slice(prefix.length)) : null;
}

export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ success: true, message: "Account deleted." });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Account deletion is not configured on the server." },
      { status: 503 }
    );
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: drafts, error: draftsError } = await supabase
      .from("drafts")
      .select("id, thumbnail_url, photo_urls");

    if (draftsError) throw new Error(draftsError.message);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const photoPaths = new Set<string>();
    for (const draft of drafts ?? []) {
      const urls = [draft.thumbnail_url, ...(draft.photo_urls ?? [])];
      for (const url of urls) {
        if (typeof url === "string") {
          const path = getPhotoPath(url, supabaseUrl);
          if (path) photoPaths.add(path);
        }
      }
    }

    if (photoPaths.size > 0) {
      const { error: storageError } = await admin.storage
        .from("photos")
        .remove([...photoPaths]);
      if (storageError) throw new Error(storageError.message);
    }

    const draftIds = (drafts ?? []).map((draft) => draft.id);
    if (draftIds.length > 0) {
      const { error: deleteError } = await admin.from("drafts").delete().in("id", draftIds);
      if (deleteError) throw new Error(deleteError.message);
    }

    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw new Error(signOutError.message);

    const { error: authDeleteError } = await admin.auth.admin.deleteUser(user.id);
    if (authDeleteError) throw new Error(authDeleteError.message);

    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete account" },
      { status: 500 }
    );
  }
}