import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import https from "node:https";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

const CONDITION_IDS: Record<string, string> = {
  "New with tags": "1000",
  "New without tags": "1500",
  "Excellent used": "3000",
  "Good - minor flaws": "4000",
  "Fair - notable flaws": "5000",
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getCategoryId(title: string): string {
  const lower = (title || "").toLowerCase();
  if (lower.includes("women") || lower.includes("ladies") || lower.includes("girl")) {
    return "15724"; // Women's Clothing
  }
  return "1059"; // Men's Clothing
}

function buildXml(draft: {
  title: string | null;
  brand: string | null;
  color: string | null;
  size: string | null;
  condition: string | null;
  flaws: string | null;
  suggested_price: number | null;
  thumbnail_url: string | null;
}): string {
  const title = escapeXml((draft.title || "Item").slice(0, 80));
  const price = (draft.suggested_price ?? 9.99).toFixed(2);
  const conditionId = CONDITION_IDS[draft.condition ?? ""] ?? "3000";
  const categoryId = getCategoryId(draft.title || "");

  const descParts = [
    draft.brand ? `Brand: ${draft.brand}` : null,
    draft.color ? `Color: ${draft.color}` : null,
    draft.size ? `Size: ${draft.size}` : null,
    draft.condition ? `Condition: ${draft.condition}` : null,
    draft.flaws ? `Notes: ${draft.flaws}` : null,
    "Listed via Listflow.",
  ].filter(Boolean);
  const description = escapeXml(descParts.join("\n"));

  const pictureXml = draft.thumbnail_url
    ? `<PictureDetails><PictureURL>${escapeXml(draft.thumbnail_url)}</PictureURL></PictureDetails>`
    : "";

  const location = escapeXml(process.env.EBAY_ITEM_LOCATION ?? "United States");

  return `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${process.env.EBAY_USER_TOKEN}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <Title>${title}</Title>
    <Description>${description}</Description>
    <PrimaryCategory><CategoryID>${categoryId}</CategoryID></PrimaryCategory>
    <StartPrice>${price}</StartPrice>
    <Quantity>1</Quantity>
    <ListingType>FixedPriceItem</ListingType>
    <ListingDuration>GTC</ListingDuration>
    <Country>US</Country>
    <Currency>USD</Currency>
    <ConditionID>${conditionId}</ConditionID>
    <Location>${location}</Location>
    ${pictureXml}
    <ShippingDetails>
      <ShippingServiceOptions>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>USPSFirstClass</ShippingService>
        <ShippingServiceCost>4.99</ShippingServiceCost>
      </ShippingServiceOptions>
    </ShippingDetails>
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
      <RefundOption>MoneyBack</RefundOption>
      <ReturnsWithinOption>Days_30</ReturnsWithinOption>
      <ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>
    </ReturnPolicy>
  </Item>
</AddFixedPriceItemRequest>`;
}

function callEbayApi(xml: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(xml, "utf-8");
    const req = https.request(
      {
        hostname: "api.ebay.com",
        path: "/ws/api.dll",
        method: "POST",
        headers: {
          "X-EBAY-API-APP-NAME": process.env.EBAY_CLIENT_ID!,
          "X-EBAY-API-DEV-NAME": process.env.EBAY_DEV_ID!,
          "X-EBAY-API-CERT-NAME": process.env.EBAY_CLIENT_SECRET!,
          "X-EBAY-API-CALL-NAME": "AddFixedPriceItem",
          "X-EBAY-API-SITEID": "0",
          "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
          "Content-Type": "text/xml",
          "Content-Length": body.length,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function POST(req: NextRequest) {
  try {
    const { draftId } = await req.json();
    if (!draftId) return NextResponse.json({ error: "draftId required" }, { status: 400 });

    const missing = ["EBAY_CLIENT_ID", "EBAY_DEV_ID", "EBAY_CLIENT_SECRET", "EBAY_USER_TOKEN"].filter(
      (k) => !process.env[k]
    );
    if (missing.length > 0) {
      return NextResponse.json({ error: `Missing config: ${missing.join(", ")}` }, { status: 500 });
    }

    const { data: draft, error: dbError } = await supabase
      .from("drafts")
      .select("*")
      .eq("id", draftId)
      .single();

    if (dbError || !draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (!draft.suggested_price) {
      return NextResponse.json({ error: "Set a price before listing" }, { status: 400 });
    }

    const xml = buildXml(draft);
    const responseXml = await callEbayApi(xml);

    const ack = responseXml.match(/<Ack>(\w+)<\/Ack>/)?.[1];

    if (ack === "Success" || ack === "Warning") {
      const itemId = responseXml.match(/<ItemID>(\d+)<\/ItemID>/)?.[1];
      return NextResponse.json({
        success: true,
        itemId,
        url: `https://www.ebay.com/itm/${itemId}`,
      });
    }

    const errorMsg =
      responseXml.match(/<ShortMessage>(.*?)<\/ShortMessage>/)?.[1] ?? "eBay listing failed";
    return NextResponse.json({ error: errorMsg }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
