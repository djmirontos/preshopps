import { LegalPageLayout, LegalSection, LegalLink } from "@/components/legal/LegalPageLayout";

export const metadata = {
  title: "Privacy Policy | Preshopps",
  description: "What data Preshopps collects, how it is used, and how account deletion works.",
};

/**
 * PRD 5.5/44 require a Privacy Policy page. Content is scoped strictly to
 * data actually collected/stored by this codebase today (profiles,
 * shops, listings, orders, messages, reviews, images via Supabase
 * Storage, Supabase Auth) -- no cookie-consent tooling, analytics
 * provider, payment processor, or email provider is claimed, since none
 * is integrated (confirmed: no such dependency in package.json).
 */
export default function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy Policy" intro="This page explains what account and marketplace data Preshopps collects today, and how it's used.">
      <LegalSection heading="1. Account data">
        <p>When you create an account, Preshopps collects:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Email address (your unique account identifier) and password</li>
          <li>Display name</li>
          <li>Optional profile photo</li>
          <li>Optional province, city/municipality, and barangay</li>
          <li>Member-since date</li>
        </ul>
        <p>Preshopps does not require your birthday, gender, phone number, or exact address.</p>
      </LegalSection>

      <LegalSection heading="2. Profile, shop, listing, order, message, and review data">
        <ul className="list-disc space-y-1 pl-5">
          <li>Shop information you provide (name, slug, location, fulfillment methods).</li>
          <li>Listing details you publish (title, category, condition, price, description, images, and, where applicable, vehicle or rental fields).</li>
          <li>Order records, including a snapshot of the listing details at the time of the order, and order status history.</li>
          <li>Messages you send in-app (text only). Messages cannot be edited or deleted once sent.</li>
          <li>Reviews you post, including rating, written text, and up to two photos.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. Public vs. private information">
        <p>Public: your display name, shop and listing details, reviews you post or receive, and seller reputation signals such as member-since date, average rating, review count, completed order count, active listing count, and Trusted Seller status.</p>
        <p>Private: your email address, exact address, internal account details, moderation notes, dispute details, and admin audit logs. Preshopps does not collect a public phone number field.</p>
      </LegalSection>

      <LegalSection heading="4. Images and media storage">
        <p>Listing, review, and shop images you upload are stored using Supabase Storage under your account, automatically resized/compressed before upload.</p>
      </LegalSection>

      <LegalSection heading="5. Authentication">
        <p>
          Sign-in, email verification, and password reset are handled by Supabase Auth. Preshopps does not store your raw password. A session
          identifier is used to keep you signed in between visits.
        </p>
      </LegalSection>

      <LegalSection heading="6. Transaction and order history">
        <p>
          Order snapshots and status history are preserved even after a listing is later edited, so both buyer and seller retain an accurate
          record of what was actually agreed at the time of the order.
        </p>
      </LegalSection>

      <LegalSection heading="7. Moderation, fraud prevention, and audit records">
        <p>
          Reports, moderation actions, account restrictions, and admin audit logs are retained as needed for trust and safety, even if the
          related content is later removed or an account is deleted.
        </p>
      </LegalSection>

      <LegalSection heading="8. Account deletion and anonymization requests">
        <p>
          You can request account deletion through <LegalLink href="/support">Support</LegalLink>. Preshopps preserves data necessary for
          completed orders, reviews, disputes, moderation, fraud prevention, and audit/history requirements, and may anonymize your public
          profile information rather than fully erase it.
        </p>
      </LegalSection>

      <LegalSection heading="9. Infrastructure">
        <p>
          Preshopps is built on Supabase (authentication, database, and file storage) and hosted on Vercel. No advertising, analytics, payment
          processing, or email-delivery provider is integrated at this time.
        </p>
      </LegalSection>

      <LegalSection heading="10. No sale of personal data">
        <p>Preshopps does not sell your personal data to third parties.</p>
      </LegalSection>

      <LegalSection heading="11. Security">
        <p>
          Preshopps applies reasonable technical safeguards to protect your data, but no online service can guarantee absolute security. Use a
          unique password and avoid sharing your account credentials, password, or one-time codes with anyone.
        </p>
      </LegalSection>

      <LegalSection heading="12. Contact">
        <p>Questions about this policy? Email <a className="font-medium text-brand-link hover:underline" href="mailto:support@preshopps.com">support@preshopps.com</a>.</p>
      </LegalSection>
    </LegalPageLayout>
  );
}
