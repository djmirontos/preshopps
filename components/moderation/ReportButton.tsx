"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { AuthGate } from "@/components/auth/AuthGate";
import { ReportDialog } from "@/components/moderation/ReportDialog";
import { submitReport, SUBMIT_REPORT_ERROR_MESSAGES, type ReportTargetType, type ReportReason } from "@/lib/moderation/report-actions";

type Props = {
  targetType: ReportTargetType;
  targetId: string;
  targetLabel: string;
  isAuthenticated: boolean;
  /** Hide entirely for the target's own owner/author -- self-report is
   * also rejected server-side, but the UI never offers a misleading
   * action either (same convention as ListingActions' isOwnListing). */
  hidden?: boolean;
  /** Safe internal path to return to after sign-in. */
  next: string;
  className?: string;
};

/**
 * One reusable Report affordance for the four canonical PRD 31 targets
 * (listing, shop, review, conversation) -- a restrained text/icon button,
 * never a prominent CTA, matching this task's own "do not scatter Report
 * buttons everywhere" instruction. A guest sees the existing AuthGate; an
 * authenticated non-owner gets the reason+description dialog and calls
 * submit_report directly.
 */
export function ReportButton({ targetType, targetId, targetLabel, isAuthenticated, hidden, next, className }: Props) {
  const [isGateOpen, setIsGateOpen] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (hidden) return null;

  async function handleSubmit(reason: ReportReason, description: string | null) {
    setIsSubmitting(true);
    setError(null);

    const result = await submitReport(targetType, targetId, reason, description);
    setIsSubmitting(false);

    if (!result.ok) {
      setError(SUBMIT_REPORT_ERROR_MESSAGES[result.code]);
      return;
    }

    setIsDialogOpen(false);
    setSubmitted(true);
  }

  if (submitted) {
    return <p className={className ?? "text-xs text-ink-muted"}>Report submitted. Thank you.</p>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (isAuthenticated ? setIsDialogOpen(true) : setIsGateOpen(true))}
        className={
          className ??
          "inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        }
      >
        <Flag className="h-3.5 w-3.5" aria-hidden="true" />
        Report
      </button>

      {isGateOpen && (
        <AuthGate
          title="Sign in to report"
          reason="Create a free account to report a problem."
          next={next}
          onClose={() => setIsGateOpen(false)}
        />
      )}

      {isDialogOpen && (
        <ReportDialog
          title={`Report ${targetLabel}`}
          isPending={isSubmitting}
          errorMessage={error}
          onSubmit={(reason, description) => void handleSubmit(reason, description)}
          onClose={() => setIsDialogOpen(false)}
        />
      )}
    </>
  );
}
