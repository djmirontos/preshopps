import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata = { title: "Forgot Password | Preshopps" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you reset instructions."
      footer={
        <Link
          href="/sign-in"
          className="rounded font-medium text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
