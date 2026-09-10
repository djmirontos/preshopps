import { LegalPageLayout, LegalSection, LegalLink } from "@/components/legal/LegalPageLayout";

export const metadata = {
  title: "Marketplace Rules | Preshopps",
  description: "The rules sellers accept before publishing, and buyers agree to when using Preshopps.",
};

/**
 * This is the page named by accept_seller_policies (0058) / the "Marketplace
 * Rules" half of the seller-policy consent checkbox (PRD 5.5). Content is
 * derived from the listing-quality, transaction, and moderation rules
 * already canonically specified (PRD 9-13, 21, 24-26, 31, 33), not invented.
 */
export default function MarketplaceRulesPage() {
  return (
    <LegalPageLayout title="Marketplace Rules" intro="These rules keep Preshopps trustworthy for both buyers and sellers. Sellers accept these rules, along with the Prohibited Items Policy, before publishing their first listing.">
      <LegalSection heading="Accurate listings">
        <p>
          Title, category, listing type (Pre-loved or Brand New), condition, price, and location must accurately describe the item. Choose the
          correct condition tier -- Like New, Very Good, Good, or Fair -- and disclose known flaws or signs of use. This is required when the
          condition is Fair.
        </p>
      </LegalSection>

      <LegalSection heading="Actual-item images">
        <ul className="list-disc space-y-1 pl-5">
          <li>Pre-loved listings must use actual photos of the item -- no stock or catalog imagery.</li>
          <li>Brand New listings need at least one actual-item photo; any additional catalog/reference images must be clearly labeled Reference Image or Catalog Image.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="No duplicate or spam listings">
        <p>
          Don&apos;t post the same item as multiple simultaneous active listings. If you use the Duplicate Listing convenience feature, review and
          correct the copy before publishing it. Duplicate or spam listings can be reported and removed.
        </p>
      </LegalSection>

      <LegalSection heading="Correct pricing, category, and location">
        <p>Set an honest price (and original price, if shown), choose the category that actually matches the item, and use the correct province, city/municipality, and barangay so buyers can find and trust your listing.</p>
      </LegalSection>

      <LegalSection heading="Transaction behavior">
        <p>
          Order requests are not guaranteed acceptance -- sellers accept, decline, or partially accept in good faith. Preshopps does not process
          payments, so buyers and sellers coordinate payment, meetup, delivery, or shipping directly. Cars, Motorcycles, and For Rent listings
          are inquiry-only: they use Message Seller instead of Add to Cart or the order-request flow.
        </p>
      </LegalSection>

      <LegalSection heading="Communication expectations">
        <p>
          Keep communication respectful and on-topic. Be cautious with external links shared in messages -- Preshopps does not verify
          third-party websites. Listing descriptions may not contain clickable external links.
        </p>
      </LegalSection>

      <LegalSection heading="Fulfillment and order handling">
        <p>
          Keep your listing status current (Available, Reserved, Paused, Sold, Archived) and respond to order requests in a timely way. Buyers
          are expected to follow through on accepted orders and to communicate promptly if plans change.
        </p>
      </LegalSection>

      <LegalSection heading="Review conduct">
        <p>
          Reviews must reflect a genuine completed-order experience. Sellers may not offer incentives for reviews and may not hide or delete
          reviews they receive -- sellers may reply once, and may report a review that violates these rules.
        </p>
      </LegalSection>

      <LegalSection heading="Harassment, scams, and spam are not allowed">
        <p>
          Harassment, scams or fraud, and spam are prohibited, along with listing anything on the{" "}
          <LegalLink href="/prohibited-items">Prohibited Items Policy</LegalLink>.
        </p>
      </LegalSection>

      <LegalSection heading="Consequences">
        <p>
          Violating these rules can result in listing or review removal, seller suspension, buyer restriction, or full account suspension.
          Existing orders, messages, reviews, disputes, and moderation history are preserved even when privileges are restricted.
        </p>
      </LegalSection>

      <LegalSection heading="Related policy">
        <p>
          This page and the <LegalLink href="/prohibited-items">Prohibited Items Policy</LegalLink> are the two policies you accept before
          publishing your first listing (see our <LegalLink href="/terms">Terms of Use</LegalLink>).
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
