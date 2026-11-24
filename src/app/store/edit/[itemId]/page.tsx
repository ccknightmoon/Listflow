"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

// "Edit in Listflow" for any active eBay listing: opens (or creates) the
// Listflow draft linked to it, then shows the normal draft editor, where
// "Update on eBay" revises the live listing in place.
export default function EditListingPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = use(params);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<{ draftId?: string; error?: string; connect?: boolean }>("/api/ebay/item/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    })
      .then((r) => {
        if (!alive) return;
        if (r.draftId) router.replace(`/drafts/${r.draftId}`);
        else setError(r.connect ? "Connect eBay in Settings first." : r.error ?? "Couldn't open this listing.");
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [itemId, router]);

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-6">
      <Link href="/store" className="inline-flex items-center gap-1 text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
        <ArrowLeft className="w-4 h-4" /> Listings
      </Link>
      {error ? (
        <div className="card p-4 text-sm" role="alert">{error}</div>
      ) : (
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Opening listing {itemId} from eBay…
        </div>
      )}
    </main>
  );
}
