"use client";

import { useState } from "react";
import { KeyRound, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { SecurityDialog } from "@/components/account/SecurityDialog";
import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { ConfirmDialog } from "@/components/seller/ConfirmDialog";
import { mapSignOutOthersError } from "@/lib/auth/security-errors";

type ActiveDialog = "password" | null;

const ROW_BUTTON_CLASS =
  "flex h-11 w-full items-center gap-2 rounded-[10px] border border-border px-3 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

/**
 * The two Account Security actions -- Change Password and Sign out other
 * devices. Self-service Change Email is intentionally NOT part of
 * Preshopps MVP: a login-email change must go through Support (see the
 * Contact section's own "Contact Support" link in AccountProfileForm.tsx)
 * rather than any updateUser({ email }) flow here.
 *
 * Closing the password dialog unmounts ChangePasswordForm entirely, which
 * is what actually guarantees its draft state is cleared from memory --
 * no separate manual "clear fields" step is needed. A successful password
 * change ends in a mandatory GLOBAL sign-out -- there is no "stay signed
 * in" success state. Sign out other devices remains the one independent,
 * manual, `scope: "others"` action that never touches the current
 * session.
 *
 * Deliberately does NOT touch profiles/get_my_profile/update_my_profile
 * at all -- every action here is Supabase Auth-native
 * (updateUser/signOut), fully independent of the Profile/Location/
 * Contact section's own save flow.
 */
export function SecuritySection() {
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [isPasswordUpdating, setIsPasswordUpdating] = useState(false);

  const [signOutOthersOpen, setSignOutOthersOpen] = useState(false);
  const [signOutOthersPending, setSignOutOthersPending] = useState(false);
  const [signOutOthersError, setSignOutOthersError] = useState<string | null>(null);
  const [signOutOthersDone, setSignOutOthersDone] = useState(false);

  function closeDialog() {
    // The dialog itself already refuses to close (via isClosable) while
    // isPasswordUpdating is true -- this is a second, defensive guard at
    // the call site.
    if (isPasswordUpdating) return;
    setActiveDialog(null);
  }

  function openSignOutOthers() {
    setSignOutOthersError(null);
    setSignOutOthersDone(false);
    setSignOutOthersOpen(true);
  }

  async function handleConfirmSignOutOthers() {
    setSignOutOthersPending(true);
    setSignOutOthersError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signOut({ scope: "others" });

    setSignOutOthersPending(false);

    if (error) {
      setSignOutOthersError(mapSignOutOthersError());
      return;
    }

    setSignOutOthersOpen(false);
    setSignOutOthersDone(true);
  }

  return (
    <section className="rounded-[14px] border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-ink">Security</h2>
      <p className="mt-1 text-xs text-ink-secondary">Manage sign-in and session security for your account.</p>

      <div className="mt-4 space-y-3">
        <button type="button" onClick={() => setActiveDialog("password")} className={ROW_BUTTON_CLASS}>
          <KeyRound className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
          Change password
        </button>

        <button type="button" onClick={openSignOutOthers} className={ROW_BUTTON_CLASS}>
          <LogOut className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
          Sign out other devices
        </button>
        {signOutOthersDone && <p role="status" className="text-xs text-ink-secondary">Other devices have been signed out.</p>}
      </div>

      {activeDialog === "password" && (
        <SecurityDialog title="Change password" isClosable={!isPasswordUpdating} onClose={closeDialog}>
          <ChangePasswordForm onUpdatingChange={setIsPasswordUpdating} />
        </SecurityDialog>
      )}

      {signOutOthersOpen && (
        <ConfirmDialog
          title="Sign out other devices?"
          description="This will sign your account out on your other devices. You will stay signed in on this device."
          confirmLabel="Sign out other devices"
          destructive
          isPending={signOutOthersPending}
          errorMessage={signOutOthersError}
          onConfirm={() => void handleConfirmSignOutOthers()}
          onClose={() => {
            if (signOutOthersPending) return;
            setSignOutOthersOpen(false);
          }}
        />
      )}
    </section>
  );
}
