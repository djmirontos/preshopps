"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SIGN_OUT_ERROR_MESSAGE, type SignOutActionState } from "@/lib/auth/sign-out-state";

/** Server Action: Server Actions (unlike plain Server Components) can
 * write cookies, so this is the correct place to clear the Supabase
 * session -- letting the client library manage the cookies rather than
 * touching them directly. Plain, session-scoped sign-out -- no `scope`
 * option, unlike Change Password's own separate, deliberately global
 * sign-out (components/account/ChangePasswordForm.tsx), which this action
 * does not touch.
 *
 * Wired via useActionState (see components/auth/SignOutForm.tsx) rather
 * than a bare `<form action={signOutAction}>`, specifically so a genuine
 * sign-out failure can return here instead of always redirecting
 * regardless of outcome -- the caller stays on their current page and
 * sees this error, never a false success. On success the redirect below
 * throws (Next's own redirect mechanism) and this function never returns
 * a value in that case; the `?signedOut=1` marker is read exactly once by
 * SignedOutNotice on the homepage, which also strips it from the URL, so
 * it never reappears on a manual refresh. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- both params are required by useActionState's own action signature; this action needs neither.
export async function signOutAction(_prevState: SignOutActionState, _formData: FormData): Promise<SignOutActionState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error("signOutAction: sign out failed:", error.message);
    return { error: SIGN_OUT_ERROR_MESSAGE };
  }

  redirect("/?signedOut=1");
}
