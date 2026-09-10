import { LegalPageLayout, LegalSection } from "@/components/legal/LegalPageLayout";

export const metadata = {
  title: "Safety Tips | Preshopps",
  description: "Practical safety reminders for buying and selling on Preshopps.",
};

/**
 * Expands PRD 44.2's own "such as" (explicitly non-exhaustive) reminder
 * list with the practical tips this task requested, all grounded in
 * features that actually exist (report/block: PRD 30-31; external-link
 * warning: PRD 25.5; Trusted Seller: PRD 27.3) -- none of this implies
 * escrow or buyer protection Preshopps doesn't provide.
 */
export default function SafetyPage() {
  return (
    <LegalPageLayout title="Safety Tips" intro="A few reminders to keep transactions on Preshopps safe and smooth.">
      <LegalSection heading="Keep communication in the app">
        <p>Message history inside Preshopps can help if there&apos;s ever a misunderstanding or a report to review.</p>
      </LegalSection>

      <LegalSection heading="Meet safely">
        <p>Choose safe, public places for in-person handoffs when that&apos;s part of your arrangement.</p>
      </LegalSection>

      <LegalSection heading="Verify before you pay">
        <p>Inspect the item and confirm its condition before completing payment, where possible.</p>
      </LegalSection>

      <LegalSection heading="Never share passwords or one-time codes">
        <p>Preshopps staff will never ask for your password or a one-time code (OTP). Treat any request for these as suspicious.</p>
      </LegalSection>

      <LegalSection heading="Be cautious with external links">
        <p>Preshopps does not verify third-party websites. Be careful with any link shared in a message, even one that looks legitimate.</p>
      </LegalSection>

      <LegalSection heading="Use Report and Block">
        <p>If something feels wrong, use the Report tools on a listing, shop, review, or conversation, or block a user to stop further contact.</p>
      </LegalSection>

      <LegalSection heading="Vehicles and rentals need extra diligence">
        <p>For Cars, Motorcycles, and For Rent listings, ask to see the documents or terms mentioned in the listing (for example, registration status or rental terms) before committing.</p>
      </LegalSection>

      <LegalSection heading="Payment and shipping are arranged directly">
        <p>Preshopps does not process payments or hold funds in escrow in MVP. Buyer and seller coordinate payment, meetup, delivery, or shipping between themselves.</p>
      </LegalSection>

      <LegalSection heading="Trusted Seller is a signal, not a guarantee">
        <p>A Trusted Seller badge reflects a seller&apos;s order history and reviews on Preshopps. It&apos;s a helpful reputation signal, not a protection plan or a guarantee of a transaction&apos;s outcome.</p>
      </LegalSection>
    </LegalPageLayout>
  );
}
