import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  // Never available in production, even to a logged-in user — this only
  // exists to sanity-check local/preview env var setup.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  return NextResponse.json({
    EBAY_OAUTH_REFRESH_TOKEN: process.env.EBAY_OAUTH_REFRESH_TOKEN
      ? `SET (${process.env.EBAY_OAUTH_REFRESH_TOKEN.length} chars)`
      : "MISSING",
    EBAY_CLIENT_ID: process.env.EBAY_CLIENT_ID ? "SET" : "MISSING",
    EBAY_CLIENT_SECRET: process.env.EBAY_CLIENT_SECRET ? "SET" : "MISSING",
    EBAY_RUNAME: process.env.EBAY_RUNAME ? "SET" : "MISSING",
    EBAY_RETURN_POLICY_ID: process.env.EBAY_RETURN_POLICY_ID ? "SET" : "MISSING",
    EBAY_SHIPPING_FREE_ID: process.env.EBAY_SHIPPING_FREE_ID ? "SET" : "MISSING",
    EBAY_SHIPPING_HEAVY_ID: process.env.EBAY_SHIPPING_HEAVY_ID ? "SET" : "MISSING",
  });
}
