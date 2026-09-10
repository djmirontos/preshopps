"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { OpenDisputeDialog } from "@/components/disputes/OpenDisputeDialog";
import { createDispute, CREATE_DISPUTE_ERROR_MESSAGES } from "@/lib/disputes/dispute-actions";
import type { OrderStatus } from "@/lib/orders/order-status-copy";
import type { DisputeStatus } from "@/lib/disputes/get-my-disputes";

const ELIGIBLE_STATUSES: ReadonlySet<OrderStatus> = new Set(["accepted", "ready", "handed_over_or_shipped", "received_confirmed"]);

const STATUS_LABELS: Record<DisputeStatus, string> = {
  opened: "Opened",
  under_review: "Under Review",
  resolved: "Resolved",
};

type Props = {
  orderId: string;
  orderStatus: OrderStatus;
  viewerUserId: string;
  existingDispute: { disputeId: string; status: DisputeStatus } | null;
};

/**
 * PRD 34: shown on both buyer and seller order detail pages (the only
 * two canonical places this task names). Renders exactly one of three
 * states -- an existing dispute's status + link, an Open Dispute action
 * (only while the order is in an eligible active status, see
 * 0074_dispute_rpcs.sql's own header for the exact status set), or
 * nothing at all -- never cluttering an order that cannot be disputed.
 */
export function DisputeSection({ orderId, orderStatus, viewerUserId, existingDispute }: Props) {
  const router = useRouter();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (existingDispute) {
    return (
      <div className="mt-4 flex items-center justify-between gap-3 rounded-[10px] border border-border bg-canvas p-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
          <span className="text-sm text-ink">Dispute: {STATUS_LABELS[existingDispute.status]}</span>
        </div>
        <Link href={`/disputes/${existingDispute.disputeId}`} className="text-sm font-medium text-brand-link hover:underline">
          View dispute
        </Link>
      </div>
    );
  }

  if (!ELIGIBLE_STATUSES.has(orderStatus)) {
    return null;
  }

  async function handleSubmit(reason: string, explanation: string, imagePaths: string[]) {
    setIsPending(true);
    setError(null);

    const result = await createDispute(orderId, reason, explanation, imagePaths);
    setIsPending(false);

    if (!result.ok) {
      setError(CREATE_DISPUTE_ERROR_MESSAGES[result.code]);
      return;
    }

    setIsDialogOpen(false);
    router.push(`/disputes/${result.disputeId}`);
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setIsDialogOpen(true)}
        className="h-11 w-full rounded-[10px] border border-danger px-4 text-sm font-semibold text-danger hover:bg-danger/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:w-auto"
      >
        Open Dispute
      </button>

      {isDialogOpen && (
        <OpenDisputeDialog
          isPending={isPending}
          errorMessage={error}
          onSubmit={(reason, explanation, imagePaths) => void handleSubmit(reason, explanation, imagePaths)}
          onClose={() => setIsDialogOpen(false)}
          uploaderUserId={viewerUserId}
          orderId={orderId}
        />
      )}
    </div>
  );
}
