import { Hero } from "@/components/marketplace/Hero";
import { CategoryStrip } from "@/components/marketplace/CategoryStrip";
import { SectionHeader } from "@/components/marketplace/SectionHeader";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { ListingRail } from "@/components/marketplace/ListingRail";
import { TrustStrip } from "@/components/marketplace/TrustStrip";
import { MOCK_BRAND_NEW, MOCK_FRESH_FINDS, MOCK_PRE_LOVED } from "@/lib/mock-data";

/**
 * Popular Shops is intentionally omitted in Phase 1: real shop-activity
 * data isn't wired yet, and per the approved design direction this section
 * must never render with fabricated shops/rankings. It should be entirely
 * absent from the page (not rendered empty) until that threshold logic and
 * real data exist.
 */

export default function Home() {
  return (
    <>
      <Hero />
      <CategoryStrip />

      <section aria-labelledby="fresh-finds-heading" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <SectionHeader
          id="fresh-finds-heading"
          title="Fresh Finds"
          eyebrow="Just listed"
          viewAllHref="/search?sort=newest"
        />
        <ListingRail>
          {MOCK_FRESH_FINDS.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </ListingRail>
      </section>

      <section aria-labelledby="preloved-heading" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <SectionHeader id="preloved-heading" title="Pre-loved" viewAllHref="/search?type=preloved" />
        <ListingRail>
          {MOCK_PRE_LOVED.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </ListingRail>
      </section>

      <section aria-labelledby="brandnew-heading" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <SectionHeader id="brandnew-heading" title="Brand New" viewAllHref="/search?type=brand_new" />
        <ListingRail>
          {MOCK_BRAND_NEW.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </ListingRail>
      </section>

      <TrustStrip />
    </>
  );
}
