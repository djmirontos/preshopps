import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
};

/**
 * Compact, centered form card shared by sign-in/sign-up/forgot/reset --
 * no illustration, no marketing panel, matches the approved Preshopps
 * visual system (warm neutral canvas, restrained brand color).
 */
export function AuthCard({ title, subtitle, children, footer }: Props) {
  return (
    <div className="mx-auto max-w-sm px-4 py-10 sm:py-16">
      <div className="rounded-[14px] border border-border bg-surface p-6 sm:p-8">
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-secondary">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <div className="mt-4 text-center text-sm text-ink-secondary">{footer}</div>}
    </div>
  );
}
