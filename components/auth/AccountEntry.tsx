"use client";

import { usePathname } from "next/navigation";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { IconButton } from "@/components/ui/IconButton";
import { UserCircle } from "lucide-react";

type Props = {
  isAuthenticated: boolean;
  email: string | null;
};

/** Desktop header Account slot: guest gets a direct link to sign-in
 * (this is a full page destination, not a quick inline action, so it
 * navigates rather than opening a modal gate) carrying the current path
 * as `next`; authenticated gets the account menu. */
export function AccountEntry({ isAuthenticated, email }: Props) {
  const pathname = usePathname();

  if (isAuthenticated) {
    return <AccountMenu email={email} />;
  }

  return (
    <IconButton
      href={`/sign-in?next=${encodeURIComponent(pathname || "/")}`}
      label="Account"
      icon={UserCircle}
    />
  );
}
