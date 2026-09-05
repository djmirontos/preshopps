import { Handshake, ShieldCheck, Star } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Signal = {
  icon: LucideIcon;
  title: string;
  description: string;
};

const SIGNALS: Signal[] = [
  { icon: Handshake, title: "Meet safely", description: "Choose safe, public meetup spots." },
  { icon: ShieldCheck, title: "Trusted sellers", description: "Look for the Trusted Seller badge." },
  { icon: Star, title: "Verified reviews", description: "Real feedback from completed orders." },
];

/** Low-key strip near the footer. Never implies Trusted Seller is purchasable. */
export function TrustStrip() {
  return (
    <section aria-labelledby="trust-heading" className="border-t border-divider bg-canvas">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <h2 id="trust-heading" className="sr-only">
          Buying and selling safely on Preshopps
        </h2>
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {SIGNALS.map(({ icon: Icon, title, description }) => (
            <li key={title} className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-ink-secondary">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-medium text-ink">{title}</p>
                <p className="text-xs text-ink-muted">{description}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
