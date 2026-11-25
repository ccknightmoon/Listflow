import { redirect } from "next/navigation";
import { legacyRedirectTarget } from "@/lib/inventory-status";

// Drafts, Listings and Scheduled are now status filters on Inventory.
export default async function LegacyRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(legacyRedirectTarget("/store", await searchParams));
}
