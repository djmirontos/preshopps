"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/seller/ConfirmDialog";
import { anonymizeUserAccount, ANONYMIZE_USER_ACCOUNT_ERROR_MESSAGES } from "@/lib/admin/account-anonymization-actions";
import type { SupportCategory } from "@/lib/support/submit-support-ticket";

type Props = {
  userId: string;
  category: SupportCategory;
  userDeletedAt: string | null;
};

/**
 * Support-ticket-driven account-deletion fulfillment (PRD 5.4/43.1) --
 * the sole entry point for MVP account anonymization. Shown only on an
 * "Account issue" ticket for a not-yet-anonymized user; admin must
 * explicitly click through a confirm dialog with a required reason --
 * anonymization is never automatic just because such a ticket exists.
 * router.refresh() on success resyncs this account's state from the
 * server (userDeletedAt flips from null), matching every other admin
 * action component's convention -- no local "done" flag is faked.
 */
export function AnonymizeAccountAction({ userId, category, userDeletedAt }: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (category !== "account_issue") {
    return null;
  }

  if (userDeletedAt) {
    return (
      <div className="mt-4">
        <Badge tone="neutral">Account anonymized</Badge>
      </div>
    );
  }

  async function handleConfirm(reason: string) {
    setIsPending(true);
    setError(null);

    const result = await anonymizeUserAccount(userId, reason);
    setIsPending(false);

    if (!result.ok) {
      setError(ANONYMIZE_USER_ACCOUNT_ERROR_MESSAGES[result.code]);
      return;
    }

    setDialogOpen(false);
    router.refresh();
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="h-9 rounded-[10px] border border-danger px-3 text-xs font-semibold text-danger hover:bg-danger/5"
      >
        Anonymize Account
      </button>

      {dialogOpen && (
        <ConfirmDialog
          title="Anonymize this account?"
          description="This removes the user's public identity (display name, photo, location) and marketplace access -- their shop and listings will no longer be visible or purchasable. Required order, review, dispute, and audit history is preserved. This can't be undone."
          confirmLabel="Anonymize account"
          destructive
          noteLabel="Reason"
          isPending={isPending}
          errorMessage={error}
          onConfirm={handleConfirm}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}
