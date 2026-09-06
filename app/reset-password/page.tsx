import { AuthCard } from "@/components/auth/AuthCard";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const metadata = { title: "Reset Password | Preshopps" };

export default function ResetPasswordPage() {
  return (
    <AuthCard title="Set a new password">
      <ResetPasswordForm />
    </AuthCard>
  );
}
