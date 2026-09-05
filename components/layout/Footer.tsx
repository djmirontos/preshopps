import Link from "next/link";

const FOOTER_LINKS = [
  { href: "#", label: "How It Works" },
  { href: "#", label: "Safety Tips" },
  { href: "#", label: "Terms" },
  { href: "#", label: "Privacy" },
  { href: "#", label: "Contact" },
];

/**
 * Extra bottom padding on mobile clears the fixed bottom nav; lg:pb-8
 * removes it once the bottom nav is hidden on desktop.
 */
export function Footer() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 pt-8 pb-24 text-center sm:px-6 lg:flex-row lg:justify-between lg:px-8 lg:pb-8 lg:text-left">
        <nav aria-label="Footer">
          <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {FOOTER_LINKS.map((link) => (
              <li key={link.label}>
                <Link
                  href={link.href}
                  className="rounded text-sm text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="text-xs text-ink-muted">&copy; {new Date().getFullYear()} Preshopps</p>
      </div>
    </footer>
  );
}
