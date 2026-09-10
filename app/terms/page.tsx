import { LegalPageLayout, LegalSection, LegalLink } from "@/components/legal/LegalPageLayout";

export const metadata = {
  title: "Terms of Use | Preshopps",
  description: "The terms that apply to buying, selling, and using Preshopps.",
};

/**
 * PRD 5.5 requires acceptance of these Terms at signup and 44 lists Terms
 * of Use as a required public informational page -- this is that page.
 * Content is scoped strictly to what Preshopps actually does today (PRD
 * 21.1/24/34.5/45/46): no escrow, no payment processing, no platform fees,
 * no seller guarantees this codebase doesn't provide. No company
 * registration details, office address, DTI/SEC numbers, named legal
 * entity, or jurisdiction/venue clause are included -- canon specifies
 * none of these, and inventing them was explicitly out of scope for this
 * task.
 */
export default function TermsPage() {
  return (
    <LegalPageLayout title="Terms of Use" intro="These Terms explain what you can expect from Preshopps and what Preshopps expects from you.">
      <LegalSection heading="1. Acceptance">
        <p>By creating a Preshopps account or using the Preshopps marketplace, you agree to these Terms of Use and to the Privacy Policy.</p>
      </LegalSection>

      <LegalSection heading="2. Eligibility and account use">
        <ul className="list-disc space-y-1 pl-5">
          <li>Email is your unique account identifier, and one account may act as both a buyer and a seller.</li>
          <li>You may maintain one shop per account.</li>
          <li>You are responsible for keeping your password secure and for activity that happens through your account.</li>
          <li>Provide accurate account information (display name, email, and any optional location fields you choose to add).</li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. The marketplace Preshopps provides">
        <p>
          Preshopps is a marketplace that connects buyers and sellers of pre-loved and brand-new items. Sellers publish and manage their own
          listings and shops; Preshopps does not own, inspect, or guarantee the items sellers list. Buyers and sellers are responsible for their
          own conduct and for arriving at their own transaction terms.
        </p>
      </LegalSection>

      <LegalSection heading="4. Listing and seller responsibilities">
        <p>As a seller, you agree to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>List items you actually have and accurately describe their title, category, listing type, condition, price, and location.</li>
          <li>Use actual photos of the item you are selling, and label any catalog/reference images on Brand New listings.</li>
          <li>Disclose known flaws or signs of use, which is required for items in Fair condition.</li>
          <li>Follow the <LegalLink href="/marketplace-rules">Marketplace Rules</LegalLink> and <LegalLink href="/prohibited-items">Prohibited Items Policy</LegalLink>, which you accept before publishing your first listing.</li>
          <li>Respond to order requests, and manage your listing status (Available, Reserved, Paused, Sold, Archived) so it reflects reality.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="5. Buyer responsibilities">
        <ul className="list-disc space-y-1 pl-5">
          <li>Review a listing&apos;s details before requesting an order.</li>
          <li>Communicate honestly with sellers and follow through on accepted orders.</li>
          <li>Coordinate payment, meetup, delivery, or shipping in good faith once an order is accepted.</li>
          <li>Report concerns using the in-app report tools rather than retaliating outside the platform.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="6. Orders and transaction arrangements">
        <p>
          Submitting an order request does not guarantee a seller will accept it. Once a seller accepts, order status (accepted, ready, handed
          over/shipped, received, completed) reflects marketplace milestones the buyer and seller record themselves -- it is not proof of payment
          or delivery. Preshopps does not calculate shipping or delivery fees; buyers and sellers agree on those directly.
        </p>
      </LegalSection>

      <LegalSection heading="7. No escrow or payment processing in MVP">
        <p>
          Preshopps does not process payments, hold funds in escrow, or arbitrate payment disputes. Buyers and sellers coordinate and complete
          payment, meetup, delivery, or shipping arrangements directly with each other, outside the platform. Preshopps currently charges no
          listing fees, commissions, or seller subscription fees.
        </p>
      </LegalSection>

      <LegalSection heading="8. User content">
        <p>
          Listing content, messages, and reviews you submit must be truthful and must not contain content prohibited by the{" "}
          <LegalLink href="/prohibited-items">Prohibited Items Policy</LegalLink>. Once sent, messages cannot be edited, deleted, or unsent --
          this preserves an accurate record for moderation and any future dispute review. Listing descriptions may not contain clickable
          external links.
        </p>
      </LegalSection>

      <LegalSection heading="9. Reviews and messaging">
        <p>
          Only a buyer with a completed order may leave a review, limited to one review per completed order; the rating reflects the seller, not
          a reusable product rating. Sellers may post one public reply per review. Preshopps messaging is text-only; be cautious with any
          external link shared in a conversation, since Preshopps does not verify third-party websites.
        </p>
      </LegalSection>

      <LegalSection heading="10. Moderation, restrictions, and suspension">
        <p>
          Preshopps may review reports, remove content that violates these Terms or the Prohibited Items Policy, and apply restrictions --
          including suspending seller privileges, restricting buyer privileges, or suspending an account entirely -- when necessary. Existing
          orders, messages, reviews, disputes, and moderation records are preserved even when privileges are restricted. A suspended seller may
          still sign in to view their suspension reason, order history, and support/appeal information.
        </p>
      </LegalSection>

      <LegalSection heading="11. Account deletion">
        <p>
          You may request account deletion through <LegalLink href="/support">Support</LegalLink>. Preshopps preserves data necessary for
          completed orders, reviews, disputes, moderation, fraud prevention, and audit/history requirements even after a deletion request, and
          public profile information may be anonymized rather than fully erased.
        </p>
      </LegalSection>

      <LegalSection heading="12. Disclaimers">
        <p>
          Preshopps provides the marketplace as an early-stage MVP. Preshopps does not guarantee that any transaction will complete, that a
          listed item&apos;s condition or description is accurate, or the conduct of any other user. Buyers and sellers interact with each other at
          their own discretion -- see our <LegalLink href="/safety">Safety Tips</LegalLink> for practical guidance.
        </p>
      </LegalSection>

      <LegalSection heading="13. Changes to these Terms">
        <p>Preshopps may update these Terms as the product changes. Continuing to use Preshopps after an update means you accept the revised Terms.</p>
      </LegalSection>

      <LegalSection heading="14. Related policies">
        <ul className="list-disc space-y-1 pl-5">
          <li><LegalLink href="/privacy">Privacy Policy</LegalLink></li>
          <li><LegalLink href="/marketplace-rules">Marketplace Rules</LegalLink></li>
          <li><LegalLink href="/prohibited-items">Prohibited Items Policy</LegalLink></li>
        </ul>
      </LegalSection>

      <LegalSection heading="15. Contact">
        <p>Questions about these Terms? Email <a className="font-medium text-brand-link hover:underline" href="mailto:support@preshopps.com">support@preshopps.com</a>.</p>
      </LegalSection>
    </LegalPageLayout>
  );
}
