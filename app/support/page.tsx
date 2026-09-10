import Link from "next/link";
import { getAuthUser } from "@/lib/auth/session";
import { LegalPageLayout, LegalSection } from "@/components/legal/LegalPageLayout";
import { SupportFormClient } from "@/components/support/SupportFormClient";

export const metadata = {
  title: "Contact / Support | Preshopps",
  description: "Get in touch with the Preshopps team.",
};

/**
 * PRD 43.1/43.2: the support form itself requires login and guests cannot
 * submit it, but the page (PRD 44's "Contact / Support") stays reachable
 * by guests, same pattern as /cart -- getAuthUser() branches the content,
 * it never redirects. PRD 43.3's support@preshopps.com is shown
 * unconditionally so unauthenticated visitors still have a contact path.
 */
export default async function SupportPage() {
  const user = await getAuthUser();

  return (
    <LegalPageLayout title="Contact / Support" intro="Reach the Preshopps team for general, account, order, or reporting questions.">
      <LegalSection heading="Email us">
        <p>
          For general, legal, or privacy questions, email{" "}
          <a className="font-medium text-brand-link hover:underline" href="mailto:support@preshopps.com">
            support@preshopps.com
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="Submit a support request">
        {user ? (
          <>
            <p>Requests are reviewed by the Preshopps team. If you&apos;d like to request account deletion, choose &quot;Account issue&quot; and describe your request below.</p>
            <div className="mt-3">
              <SupportFormClient />
            </div>
          </>
        ) : (
          <p>
            Submitting a support request requires an account, so we can follow up with you. Please{" "}
            <Link
              href={`/sign-in?next=${encodeURIComponent("/support")}`}
              className="rounded font-medium text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              sign in
            </Link>{" "}
            to submit a request.
          </p>
        )}
      </LegalSection>
    </LegalPageLayout>
  );
}
