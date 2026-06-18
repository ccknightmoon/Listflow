import { NextResponse } from "next/server";
import { EBAY_SCOPES } from "@/lib/ebay-oauth";

export const runtime = "nodejs";

export async function GET() {
  const params = new URLSearchParams({
    client_id: process.env.EBAY_CLIENT_ID!,
    redirect_uri: process.env.EBAY_RUNAME!,
    response_type: "code",
    scope: EBAY_SCOPES,
  });
  return NextResponse.redirect(`https://auth.ebay.com/oauth2/authorize?${params}`);
}
