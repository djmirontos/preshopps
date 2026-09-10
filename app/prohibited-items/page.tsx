import { LegalPageLayout, LegalSection, LegalLink } from "@/components/legal/LegalPageLayout";

export const metadata = {
  title: "Prohibited Items Policy | Preshopps",
  description: "Items that may never be listed for sale on Preshopps.",
};

const PROHIBITED_EXAMPLES = [
  "Weapons and ammunition",
  "Illegal drugs",
  "Prescription medicines",
  "Counterfeit goods",
  "Stolen goods",
  "Adult sexual products",
  "Hazardous chemicals",
  "Alcohol",
  "Nicotine products",
  "Anything illegal under applicable Philippine law",
];

/**
 * Reproduces PRD 32's prohibited-item examples verbatim -- nothing added
 * from general knowledge. Canon itself states "Examples include" and
 * "This list may be expanded by policy," i.e. it is explicitly
 * non-exhaustive, so this page says that plainly rather than presenting
 * the list as complete.
 */
export default function ProhibitedItemsPage() {
  return (
    <LegalPageLayout title="Prohibited Items Policy" intro="Preshopps must launch with a clear prohibited-items policy. The examples below may never be listed for sale.">
      <LegalSection heading="Examples of prohibited items">
        <ul className="list-disc space-y-1 pl-5">
          {PROHIBITED_EXAMPLES.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </LegalSection>

      <LegalSection heading="This list is not exhaustive">
        <p>
          These are examples, not a complete list. This policy may be expanded, and a listing may still be removed if it is unsafe, illegal, or
          against the spirit of these rules even if the specific item isn&apos;t named above.
        </p>
      </LegalSection>

      <LegalSection heading="Reporting a prohibited listing">
        <p>
          If you see a listing that appears to violate this policy, use the Report action on the listing and choose &quot;Prohibited Item&quot; as the
          reason. See the <LegalLink href="/marketplace-rules">Marketplace Rules</LegalLink> for what happens after a report is reviewed.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
