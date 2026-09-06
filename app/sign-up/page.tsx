import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { getAuthUser } from "@/lib/auth/session";
import { getSafeNextPath } from "@/lib/auth/safe-redirect";

type PageProps = {
  searchParams: Promise<{ next?: string }>;
};

export const metadata = { title: "Create Account | Preshopps" };

export default async function SignUpPage({ searchParams }: PageProps) {
  const { next: rawNext } = await searchParams;
  const next = getSafeNextPath(rawNext);

  const user = await getAuthUser();
  if (user) {
    redirect(next);
  }

  return (
    <AuthCard title="Create your account" subtitle="Buy and sell pre-loved and brand-new items.">
      <SignUpForm next={next} />
    </AuthCard>
  );
}
