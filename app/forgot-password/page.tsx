import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata = { title: "Forgot Password | Preshopps" };

// ForgotPasswordForm owns its own AuthCard (title/subtitle/footer change
// per step -- email/code/password), unlike the other auth pages whose
// copy is static.
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
