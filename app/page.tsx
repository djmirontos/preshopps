import { Hero } from "@/components/marketplace/Hero";
import { CategoryStrip } from "@/components/marketplace/CategoryStrip";
import { SectionHeader } from "@/components/marketplace/SectionHeader";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { ListingRail } from "@/components/marketplace/ListingRail";
import { SectionEmptyState } from "@/components/marketplace/SectionEmptyState";
import { TrustStrip } from "@/components/marketplace/TrustStrip";
import { getHomepageMarketplaceData } from "@/lib/marketplace/browse-listings";

/**
 * Popular Shops is intentionally omitted in Phase 1: real shop-activity
 * data isn't wired yet, and per the approved design direction this section
 * must never render with fabricated shops/rankings. It should be entirely
 * absent from the page (not rendered empty) until that threshold logic and
 * real data exist.
 */

export default async function Home() {
  const { freshFinds, preLoved, brandNew } = await getHomepageMarketplaceData();

  return (
    <>
      <Hero />
      <CategoryStrip />

      {/* Fresh Finds always stays visible — populated, a genuine-zero-rows
          empty state, or an RPC-failure fallback — never omitted. */}
      <section aria-labelledby="fresh-finds-heading" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <SectionHeader
          id="fresh-finds-heading"
          title="Fresh Finds"
          eyebrow="Just listed"
          viewAllHref="/search?sort=newest"
        />
        {freshFinds.hadError ? (
          <SectionEmptyState message="Unable to load listings right now." />
        ) : freshFinds.listings.length === 0 ? (
          <SectionEmptyState message="No listings yet. Be the first to sell something." />
        ) : (
          <ListingRail>
            {freshFinds.listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </ListingRail>
        )}
      </section>

      {/* Pre-loved/Brand New: shown with an error message if the RPC failed
          (never silently hidden on a real error), otherwise omitted
          entirely when there's genuinely no inventory yet. */}
      {(preLoved.hadError || preLoved.listings.length > 0) && (
        <section aria-labelledby="preloved-heading" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <SectionHeader id="preloved-heading" title="Pre-loved" viewAllHref="/search?type=preloved" />
          {preLoved.hadError ? (
            <SectionEmptyState message="Unable to load listings right now." />
          ) : (
            <ListingRail>
              {preLoved.listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </ListingRail>
          )}
        </section>
      )}

      {(brandNew.hadError || brandNew.listings.length > 0) && (
        <section aria-labelledby="brandnew-heading" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <SectionHeader id="brandnew-heading" title="Brand New" viewAllHref="/search?type=brand_new" />
          {brandNew.hadError ? (
            <SectionEmptyState message="Unable to load listings right now." />
          ) : (
            <ListingRail>
              {brandNew.listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </ListingRail>
          )}
        </section>
      )}

      <TrustStrip />
    </>
  );
}
