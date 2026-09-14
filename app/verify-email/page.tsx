import { AuthCard } from "@/components/auth/AuthCard";
import { VerifyEmailForm } from "@/components/auth/VerifyEmailForm";
import { getSafeNextPath } from "@/lib/auth/safe-redirect";

type PageProps = {
  searchParams: Promise<{ next?: string }>;
};

export const metadata = { title: "Verify Your Email | Preshopps" };

/**
 * Deliberately does not redirect an already-authenticated visitor the way
 * /sign-in and /sign-up do -- there is no meaningful "already signed in"
 * state to special-case here. The pending email lives only in
 * sessionStorage (see VerifyEmailForm), so a signed-in user with nothing
 * pending simply sees that component's own "couldn't find a pending email
 * verification" fallback, which already links onward safely; no separate
 * server-side check is needed.
 */
export default async function VerifyEmailPage({ searchParams }: PageProps) {
  const { next: rawNext } = await searchParams;
  const next = getSafeNextPath(rawNext);

  return (
    <AuthCard title="Verify your email">
      <VerifyEmailForm next={next} />
    </AuthCard>
  );
}
