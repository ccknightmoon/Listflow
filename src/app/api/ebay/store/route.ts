import { NextResponse } from "next/server";
import { getAllOffers, getAllInventoryItems } from "@/lib/ebay-inventory";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [offersRes, itemsRes] = await Promise.all([
      getAllOffers(),
      getAllInventoryItems(),
    ]);

    if (offersRes.status >= 400) {
      return NextResponse.json({ error: "Failed to fetch eBay offers" }, { status: 400 });
    }

    type Offer = {
      offerId: string;
      sku: string;
      status: string;
      pricingSummary?: { price?: { value?: string } };
      listing?: { listingId?: string };
    };
    type InventoryItem = {
      sku: string;
      product?: { title?: string; imageUrls?: string[] };
    };

    const offers = ((offersRes.data as { offers?: Offer[] }).offers ?? [])
      .filter((o) => o.status === "PUBLISHED");

    const inventoryItems = (itemsRes.data as { inventoryItems?: InventoryItem[] }).inventoryItems ?? [];
    const itemBySku = new Map(inventoryItems.map((i) => [i.sku, i]));

    const listings = offers.map((offer) => {
      const item = itemBySku.get(offer.sku);
      return {
        listingId: offer.listing?.listingId ?? "",
        offerId: offer.offerId,
        sku: offer.sku,
        title: item?.product?.title ?? offer.sku,
        price: offer.pricingSummary?.price?.value ?? null,
        gallery: item?.product?.imageUrls?.[0] ?? null,
      };
    });

    return NextResponse.json({ listings, total: listings.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
