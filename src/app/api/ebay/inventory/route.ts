import { NextResponse } from "next/server";
import { getAllOffers, getAllInventoryItems } from "@/lib/ebay-inventory";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [offersRes, itemsRes] = await Promise.all([getAllOffers(), getAllInventoryItems()]);

    const offers = ((offersRes.data as { offers?: unknown[] }).offers ?? []) as Array<{
      offerId: string;
      sku: string;
      status: string;
      listing?: { listingId: string };
      pricingSummary?: { price: { value: string } };
    }>;

    const items = ((itemsRes.data as { inventoryItems?: unknown[] }).inventoryItems ?? []) as Array<{
      sku: string;
      product?: { title?: string; imageUrls?: string[] };
    }>;

    const offerMap = new Map(offers.map((o) => [o.sku, o]));

    // Show all inventory items; join offer data where available
    const combined = items.map((item) => {
      const offer = offerMap.get(item.sku);
      return {
        offerId: offer?.offerId ?? null,
        sku: item.sku,
        status: offer?.status ?? "NO_OFFER",
        listingId: offer?.listing?.listingId,
        price: offer?.pricingSummary?.price.value,
        title: item.product?.title ?? item.sku,
        thumbnail: item.product?.imageUrls?.[0] ?? null,
      };
    });

    return NextResponse.json({ listings: combined });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
