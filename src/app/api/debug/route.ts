import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
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
