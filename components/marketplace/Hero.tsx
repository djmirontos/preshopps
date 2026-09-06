/**
 * Desktop-only (>=1024px), compact text-only introduction -- no CTAs.
 * "Browse Items"/"Start Selling" were removed per the product owner's
 * revision (search lives in the header and category discovery already
 * provides both paths; nothing replaces them). Entirely hidden below
 * 1024px: mobile goes straight from the header/search into category
 * discovery. A hidden block-level section occupies zero layout space, so
 * there's no empty spacer left behind where the hero used to be.
 */
export function Hero() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="hidden lg:block mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"
    >
      <h1 id="hero-heading" className="text-3xl font-bold leading-tight tracking-tight text-ink">
        Find something worth loving again.
      </h1>
      <p className="mt-1 max-w-xl text-base text-ink-secondary">
        Buy and sell pre-loved and brand-new items from local sellers.
      </p>
    </section>
  );
}
