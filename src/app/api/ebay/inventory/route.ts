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

    const itemMap = new Map(items.map((i) => [i.sku, i]));

    const combined = offers.map((offer) => {
      const item = itemMap.get(offer.sku);
      return {
        offerId: offer.offerId,
        sku: offer.sku,
        status: offer.status,
        listingId: offer.listing?.listingId,
        price: offer.pricingSummary?.price.value,
        title: item?.product?.title ?? offer.sku,
        thumbnail: item?.product?.imageUrls?.[0] ?? null,
      };
    });

    return NextResponse.json({ listings: combined });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
