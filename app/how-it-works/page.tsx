import { LegalPageLayout, LegalSection, LegalLink } from "@/components/legal/LegalPageLayout";

export const metadata = {
  title: "How It Works | Preshopps",
  description: "How buying and selling on Preshopps works today.",
};

/**
 * PRD 44.1 requires exactly two sections (How to Buy, How to Sell); this
 * page includes those plus the additional coverage this task asked for
 * (messaging, reviews, Trusted Seller, inquiry-only categories), all
 * grounded in canon (PRD 20-27, 13.3) rather than invented. The no-
 * payment-processing disclaimer is repeated explicitly, matching PRD
 * 21.1/24/46.
 */
export default function HowItWorksPage() {
  return (
    <LegalPageLayout title="How It Works" intro="Preshopps connects local buyers and sellers of pre-loved and brand-new items.">
      <LegalSection heading="How to buy">
        <ul className="list-disc space-y-1 pl-5">
          <li>Browse and search the marketplace freely, even without an account.</li>
          <li>Message a seller if you have questions, or add an eligible item to your cart.</li>
          <li>Submit an order request -- the seller can accept, decline, or partially accept it.</li>
          <li>Once accepted, coordinate payment and pickup/delivery/shipping directly with the seller.</li>
          <li>Confirm receipt when you get the item, then leave a review.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="How to sell">
        <ul className="list-disc space-y-1 pl-5">
          <li>Create one shop for your account -- no separate seller registration.</li>
          <li>Publish a listing: at minimum a title to save it as a Draft, then full details, actual-item photos, and known flaws (if condition is Fair) before publishing.</li>
          <li>Respond to order requests -- accept, decline, or partially accept.</li>
          <li>Manage fulfillment (Meet-up, Pickup, Local delivery, or Shipping) and keep your listing status current.</li>
          <li>Build trust over time through completed orders and reviews.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="No payment processing or shipping calculation">
        <p>
          Preshopps does not process payments or arrange shipping/delivery in MVP. Buyers and sellers agree on payment method, fees, and
          fulfillment details directly, most often through in-app messaging.
        </p>
      </LegalSection>

      <LegalSection heading="Messaging">
        <p>Text-based, in-app messaging keeps a conversation tied to either a specific listing or a general shop inquiry, so history stays organized and available if it&apos;s ever needed later.</p>
      </LegalSection>

      <LegalSection heading="Reviews">
        <p>Only a buyer with a completed order can leave a review for that order, and the rating reflects the seller&apos;s reputation rather than the specific product.</p>
      </LegalSection>

      <LegalSection heading="Trusted Seller">
        <p>
          A Trusted Seller badge is calculated automatically from a seller&apos;s verified email, completed order count, review count, average
          rating, and moderation standing. It updates over time and can be removed if a seller no longer qualifies -- it&apos;s a reputation signal,
          not a permanent title or a guarantee.
        </p>
      </LegalSection>

      <LegalSection heading="Cars, Motorcycles, and For Rent">
        <p>
          These categories are inquiry-only: you can browse, favorite, share, and message the seller, but there&apos;s no Add to Cart or standard
          order-request flow. Specific terms, viewing details, and rental dates are worked out directly with the seller through messaging.
        </p>
      </LegalSection>

      <LegalSection heading="Staying safe">
        <p>See our <LegalLink href="/safety">Safety Tips</LegalLink> for practical guidance while coordinating a transaction.</p>
      </LegalSection>
    </LegalPageLayout>
  );
}
