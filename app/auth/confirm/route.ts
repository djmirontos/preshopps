import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSafeNextPath } from "@/lib/auth/safe-redirect";

// Only the flows Preshopps actually sends: sign-up confirmation and
// password-recovery emails. An arbitrary `type` query value is never cast
// or passed through -- it must match one of these literals or the
// token_hash branch is treated as not present.
const SUPPORTED_EMAIL_OTP_TYPES = ["signup", "recovery"] as const;
type SupportedEmailOtpType = (typeof SUPPORTED_EMAIL_OTP_TYPES)[number];

function isSupportedEmailOtpType(value: string | null): value is SupportedEmailOtpType {
  return (SUPPORTED_EMAIL_OTP_TYPES as readonly string[]).includes(value ?? "");
}

const INVALID_LINK_PATH = "/sign-in?auth_error=invalid_link";

/**
 * Email confirmation / recovery link handler, following Supabase's own
 * documented Next.js patterns -- not a custom token system. A legitimate
 * Supabase redirect here takes exactly one of two real shapes, checked in
 * this deterministic order (never both):
 *
 *  1. token_hash + a supported type -> verifyOtp(). This is the OTP-link
 *     email template shape.
 *  2. otherwise, code -> exchangeCodeForSession(). This is the PKCE shape,
 *     required so the session actually persists via the Supabase SSR
 *     cookie mechanism.
 *  3. otherwise (or if either exchange fails) -> a safe invalid-link
 *     state. Never forwarded to `next` as if it succeeded, and never
 *     leaks the token/code/raw error into the redirect.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");
  const next = getSafeNextPath(searchParams.get("next"));

  if (tokenHash && isSupportedEmailOtpType(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

    if (error) {
      return NextResponse.redirect(new URL(INVALID_LINK_PATH, origin));
    }

    return NextResponse.redirect(new URL(next, origin));
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(new URL(INVALID_LINK_PATH, origin));
    }

    return NextResponse.redirect(new URL(next, origin));
  }

  return NextResponse.redirect(new URL(INVALID_LINK_PATH, origin));
}
