import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";

export const metadata = { title: "Draft saved | Preshopps" };

/**
 * Deliberately minimal placeholder -- Save Draft (ListingForm, /sell) needs
 * a safe place to send the seller to after create_listing succeeds, but
 * full edit behavior (prefilling from get_my_listing, image management,
 * publish) is explicitly out of scope for this slice. This page shows a
 * static confirmation only; it never reads the listing itself (via
 * get_my_listing or otherwise), so there is nothing here that constitutes
 * "edit behavior" and nothing listing-specific to get wrong or leak --
 * the same generic message renders regardless of which id is in the URL.
 * Still gated on authentication, matching every other seller page's own
 * convention, so a guest is never shown even this much.
 */
export default async function SellListingEditPlaceholderPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const { listingId } = await params;
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent(`/sell/${listingId}/edit`)}`);
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-10 sm:py-16">
      <div className="rounded-[14px] border border-border bg-surface p-6 text-center sm:p-8">
        <h1 className="text-xl font-bold text-ink">Draft saved</h1>
        <p className="mt-3 text-sm text-ink-secondary">
          Your listing was saved as a Draft. Editing, photos, and publishing are coming soon.
        </p>
        <Link
          href="/account"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-[10px] border border-border px-5 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Back to Account
        </Link>
      </div>
    </div>
  );
}
