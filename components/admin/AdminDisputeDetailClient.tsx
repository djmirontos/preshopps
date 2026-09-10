"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/seller/ConfirmDialog";
import { formatOrderDate } from "@/lib/orders/format-order-date";
import { formatMessageTimestamp } from "@/lib/messaging/format-message-time";
import {
  addDisputeAdminNote,
  updateDisputeStatus,
  adminCancelDisputedOrder,
  adminCompleteDisputedOrder,
  ADD_DISPUTE_ADMIN_NOTE_ERROR_MESSAGES,
  UPDATE_DISPUTE_STATUS_ERROR_MESSAGES,
  ADMIN_CANCEL_DISPUTED_ORDER_ERROR_MESSAGES,
  ADMIN_COMPLETE_DISPUTED_ORDER_ERROR_MESSAGES,
} from "@/lib/admin/dispute-admin-actions";
import type { AdminDisputeDetail } from "@/lib/admin/get-admin-dispute-detail";
import type { AdminDisputeMessage } from "@/lib/admin/get-admin-dispute-messages";
import type { DisputeStatus } from "@/lib/disputes/get-my-disputes";

const STATUS_LABELS: Record<DisputeStatus, string> = {
  opened: "Opened",
  under_review: "Under Review",
  resolved: "Resolved",
};

type Props = {
  dispute: AdminDisputeDetail;
  imageUrls: string[];
  messages: AdminDisputeMessage[];
};

type DialogKind = "cancel" | "complete" | null;

/**
 * Admin dispute workspace (PRD 34.4/ARCHITECTURE S20): order snapshot,
 * parties, evidence, relevant messages, current status, forward-only
 * status transitions, private admin notes, and the two order-status
 * actions (cancel / mark completed). Every mutation calls router.refresh()
 * on success so this component's props resync from the server rather than
 * assuming an outcome, matching BuyerOrderActionsClient's own convention.
 */
export function AdminDisputeDetailClient({ dispute, imageUrls, messages }: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);

  async function handleTransition(status: DisputeStatus) {
    setActionPending(status);
    setActionError(null);

    const result = await updateDisputeStatus(dispute.disputeId, status);
    setActionPending(null);

    if (!result.ok) {
      setActionError(UPDATE_DISPUTE_STATUS_ERROR_MESSAGES[result.code]);
      return;
    }

    router.refresh();
  }

  async function handleAddNote() {
    if (note.trim().length === 0) return;
    setIsSubmittingNote(true);
    setNoteError(null);

    const result = await addDisputeAdminNote(dispute.disputeId, note.trim());
    setIsSubmittingNote(false);

    if (!result.ok) {
      setNoteError(ADD_DISPUTE_ADMIN_NOTE_ERROR_MESSAGES[result.code]);
      return;
    }

    setNote("");
    router.refresh();
  }

  async function handleCancel(reason: string) {
    setActionPending("cancel");
    setActionError(null);

    const result = await adminCancelDisputedOrder(dispute.disputeId, reason);
    setActionPending(null);

    if (!result.ok) {
      setActionError(ADMIN_CANCEL_DISPUTED_ORDER_ERROR_MESSAGES[result.code]);
      return;
    }

    setDialog(null);
    router.refresh();
  }

  async function handleComplete() {
    setActionPending("complete");
    setActionError(null);

    const result = await adminCompleteDisputedOrder(dispute.disputeId);
    setActionPending(null);

    if (!result.ok) {
      setActionError(ADMIN_COMPLETE_DISPUTED_ORDER_ERROR_MESSAGES[result.code]);
      return;
    }

    setDialog(null);
    router.refresh();
  }

  const canCancelOrComplete = dispute.orderStatus === "disputed";
  const canTransition = dispute.status !== "resolved";

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink lg:text-2xl">{dispute.orderPublicCode}</h1>
        <Badge tone={dispute.status === "opened" ? "brand" : "neutral"}>{STATUS_LABELS[dispute.status]}</Badge>
      </div>
      <p className="mt-1 text-sm text-ink-secondary">
        Order status: {dispute.orderStatus} · {dispute.shopName} ({dispute.shopOwnerDisplayName}) · Buyer: {dispute.buyerDisplayName}
      </p>

      <div className="mt-4 rounded-[14px] border border-border bg-surface p-4">
        <p className="text-xs font-medium text-ink-muted">Reason</p>
        <p className="mt-1 text-sm font-semibold text-ink">{dispute.reason}</p>
        <p className="mt-3 text-xs font-medium text-ink-muted">Explanation</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{dispute.explanation}</p>
        <p className="mt-3 text-xs text-ink-muted">
          Opened by {dispute.openerDisplayName} on {formatOrderDate(dispute.createdAt)}
          {dispute.resolvedAt && ` · Resolved by ${dispute.resolvedByDisplayName} on ${formatOrderDate(dispute.resolvedAt)}`}
        </p>
      </div>

      {imageUrls.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-ink-muted">Evidence</p>
          <div className="mt-2 flex gap-2">
            {imageUrls.map((url) => (
              <span key={url} className="relative h-20 w-20 overflow-hidden rounded-[10px] bg-divider">
                <Image src={url} alt="" fill sizes="80px" className="object-contain" />
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        <p className="text-sm font-semibold text-ink">Status</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {canTransition && dispute.status === "opened" && (
            <button
              type="button"
              onClick={() => void handleTransition("under_review")}
              disabled={actionPending !== null}
              className="h-9 rounded-[10px] border border-border bg-surface px-3 text-xs font-semibold text-ink hover:border-brand-link disabled:opacity-60"
            >
              Mark Under Review
            </button>
          )}
          {canTransition && (
            <button
              type="button"
              onClick={() => void handleTransition("resolved")}
              disabled={actionPending !== null}
              className="h-9 rounded-[10px] bg-brand-action px-3 text-xs font-semibold text-brand-action-text hover:brightness-95 disabled:opacity-60"
            >
              Mark Resolved
            </button>
          )}
        </div>
      </div>

      {canCancelOrComplete && (
        <div className="mt-4">
          <p className="text-sm font-semibold text-ink">Order actions</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDialog("cancel")}
              disabled={actionPending !== null}
              className="h-9 rounded-[10px] border border-danger px-3 text-xs font-semibold text-danger hover:bg-danger/5 disabled:opacity-60"
            >
              Cancel order
            </button>
            <button
              type="button"
              onClick={() => setDialog("complete")}
              disabled={actionPending !== null}
              className="h-9 rounded-[10px] border border-border bg-surface px-3 text-xs font-semibold text-ink hover:border-brand-link disabled:opacity-60"
            >
              Mark order completed
            </button>
          </div>
        </div>
      )}

      {actionError && <p className="mt-3 text-sm text-danger">{actionError}</p>}

      <div className="mt-6">
        <p className="text-sm font-semibold text-ink">Private admin notes</p>
        <p className="text-xs text-ink-muted">Never shown to users.</p>
        <ul className="mt-2 space-y-2">
          {dispute.adminNotes.map((n, index) => (
            <li key={index} className="rounded-[10px] bg-canvas p-3">
              <p className="text-sm text-ink">{n.note}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {n.adminDisplayName} · {formatOrderDate(n.createdAt)}
              </p>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <label htmlFor="admin-dispute-note" className="sr-only">
            Add a private note
          </label>
          <textarea
            id="admin-dispute-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Add a private note…"
            className="w-full rounded-[10px] border border-border bg-canvas p-2.5 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
          {noteError && <p className="mt-1 text-xs text-danger">{noteError}</p>}
          <button
            type="button"
            onClick={() => void handleAddNote()}
            disabled={isSubmittingNote || note.trim().length === 0}
            className="mt-2 h-9 rounded-[10px] border border-border bg-surface px-3 text-xs font-semibold text-ink hover:border-brand-link disabled:opacity-60"
          >
            {isSubmittingNote ? "Saving…" : "Add note"}
          </button>
        </div>
      </div>

      <div className="mt-6">
        <p className="text-sm font-semibold text-ink">Related messages</p>
        {messages.length === 0 ? (
          <p className="mt-1 text-sm text-ink-secondary">No messages between this buyer and shop.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {messages.map((message) => (
              <li key={message.messageId} className="rounded-[10px] bg-canvas p-3">
                <p className="text-xs font-medium text-ink-secondary">{message.isFromBuyer ? "Buyer" : "Seller"}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{message.body}</p>
                <p className="mt-1 text-xs text-ink-muted">{formatMessageTimestamp(message.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {dialog === "cancel" && (
        <ConfirmDialog
          title="Cancel this order?"
          description="This releases any reserved inventory and marks the order cancelled. This can't be undone."
          confirmLabel="Cancel order"
          destructive
          noteLabel="Reason"
          isPending={actionPending === "cancel"}
          errorMessage={actionError}
          onConfirm={handleCancel}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "complete" && (
        <ConfirmDialog
          title="Mark this order completed?"
          description="Use this only when evidence shows the transaction was actually fulfilled. This can't be undone."
          confirmLabel="Mark completed"
          isPending={actionPending === "complete"}
          errorMessage={actionError}
          onConfirm={() => void handleComplete()}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
