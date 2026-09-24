import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { SignInForm } from "@/components/auth/SignInForm";
import { PasswordUpdatedNotice } from "@/components/auth/PasswordUpdatedNotice";
import { getAuthUser } from "@/lib/auth/session";
import { getSafeNextPath } from "@/lib/auth/safe-redirect";

type PageProps = {
  searchParams: Promise<{ next?: string }>;
};

export const metadata = { title: "Sign In | Preshopps" };

export default async function SignInPage({ searchParams }: PageProps) {
  const { next: rawNext } = await searchParams;
  const next = getSafeNextPath(rawNext);

  const user = await getAuthUser();
  if (user) {
    redirect(next);
  }

  return (
    <AuthCard title="Sign in" subtitle="Welcome back to Preshopps.">
      {/* One-time explanation after ChangePasswordForm's own successful
          password update + global sign-out redirect -- see
          PasswordUpdatedNotice's own file for why a per-tab sessionStorage
          flag, never a URL marker or a toast fired on the previous page,
          is what drives this. No Suspense boundary needed -- unlike
          SignedOutNotice, this reads no search params. Renders nothing
          when the flag is absent (the ordinary sign-in pageview). */}
      <PasswordUpdatedNotice />
      <SignInForm next={next} />
    </AuthCard>
  );
}
