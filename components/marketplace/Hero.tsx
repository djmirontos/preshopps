import Link from "next/link";

/**
 * Deliberately compact — mobile ~100px, desktop ~150px. No illustration,
 * no gradient, no full-viewport section. Search lives in the header, not
 * inside the hero.
 */
export function Hero() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-7"
    >
      <h1
        id="hero-heading"
        className="text-[26px] font-bold leading-tight tracking-tight text-ink sm:text-3xl lg:text-3xl"
      >
        Find something worth loving again.
      </h1>
      <p className="mt-1.5 max-w-xl text-sm text-ink-secondary sm:text-base">
        Buy and sell pre-loved and brand-new items from local sellers.
      </p>
      <div className="mt-3 hidden items-center gap-4 lg:flex">
        <Link
          href="#"
          className="rounded text-sm font-medium text-brand-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Browse Items
        </Link>
        <span className="text-border" aria-hidden="true">
          •
        </span>
        <Link
          href="#"
          className="rounded text-sm font-medium text-brand-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Start Selling
        </Link>
      </div>
    </section>
  );
}
