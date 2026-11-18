import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { fetchAspectDefs } from "@/lib/ebay-aspects";
import { rankOptions } from "@/lib/combobox";

export const runtime = "nodejs";

// Type-to-search over an aspect's FULL eBay value list (Brand can have
// thousands; the browser only gets the first part up front).
// ?categoryId=…&aspect=Brand&q=carh → { values: [...] } (best first, ≤ 200)
export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const connection = await requireEbayConnection(auth);
  if (!connection) return NextResponse.json({ values: [] });
  const sp = new URL(req.url).searchParams;
  const categoryId = sp.get("categoryId") ?? "";
  const aspect = (sp.get("aspect") ?? "").toLowerCase();
  const q = (sp.get("q") ?? "").slice(0, 60);
  if (!/^\d+$/.test(categoryId) || !aspect) return NextResponse.json({ values: [] });
  return ebayContext.run(connection, async () => {
    const def = (await fetchAspectDefs(categoryId)).find((d) => d.name.toLowerCase() === aspect);
    return NextResponse.json({ values: def ? rankOptions(def.values, q, 200) : [] }, { headers: { "Cache-Control": "private, max-age=600" } });
  });
}
