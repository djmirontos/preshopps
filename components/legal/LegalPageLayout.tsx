import type { ReactNode } from "react";
import Link from "next/link";

type LegalPageLayoutProps = {
  title: string;
  intro?: string;
  children: ReactNode;
};

/**
 * Shared shell for the public informational pages (PRD 44): Terms,
 * Privacy, Marketplace Rules, Prohibited Items, How It Works, Safety
 * Tips, and Support. Plain prose sections only -- no CMS, no rich-text
 * renderer -- matching this app's existing static-page conventions (e.g.
 * /notifications, /cart use the same mx-auto max-w-3xl shell). A single
 * h1 page title plus h2 section headings (via LegalSection) keeps the
 * heading hierarchy correct for screen readers without any page having
 * to hand-roll its own spacing/typography.
 */
export function LegalPageLayout({ title, intro, children }: LegalPageLayoutProps) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-xl font-bold text-ink lg:text-2xl">{title}</h1>
      {intro && <p className="mt-2 text-sm text-ink-secondary">{intro}</p>}
      <div className="mt-6 space-y-6">{children}</div>
    </div>
  );
}

type LegalSectionProps = {
  heading: string;
  children: ReactNode;
};

export function LegalSection({ heading, children }: LegalSectionProps) {
  return (
    <section>
      <h2 className="text-base font-semibold text-ink">{heading}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-ink-secondary">{children}</div>
    </section>
  );
}

/** Shared inline internal-link style, matching SignInForm/SignUpForm's own text-brand-link convention. */
export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="rounded font-medium text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
      {children}
    </Link>
  );
}
