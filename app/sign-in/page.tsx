import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { SignInForm } from "@/components/auth/SignInForm";
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
      <SignInForm next={next} />
    </AuthCard>
  );
}
