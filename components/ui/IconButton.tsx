import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

type IconButtonProps = {
  icon: LucideIcon;
  label: string;
  href?: string;
  active?: boolean;
  className?: string;
};

/**
 * 44x44 tap target by default so it meets the minimum touch-target size
 * regardless of the icon's own visual size.
 */
export function IconButton({
  icon: Icon,
  label,
  href = "#",
  active = false,
  className,
}: IconButtonProps) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        "inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-secondary transition-colors duration-150 hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        active && "text-brand-hover",
        className,
      )}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </Link>
  );
}
