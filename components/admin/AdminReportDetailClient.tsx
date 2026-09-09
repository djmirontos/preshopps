"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/seller/ConfirmDialog";
import { formatOrderDate } from "@/lib/orders/format-order-date";
import {
  resolveAdminReport,
  applyUserRestriction,
  liftUserRestriction,
  RESOLVE_ADMIN_REPORT_ERROR_MESSAGES,
  APPLY_USER_RESTRICTION_ERROR_MESSAGES,
  LIFT_USER_RESTRICTION_ERROR_MESSAGES,
} from "@/lib/admin/moderation-actions";
import type { ReportStatus } from "@/lib/admin/get-admin-reports";
import type { AdminReportDetail } from "@/lib/admin/get-admin-report-detail";
import type { AdminUserRestriction, RestrictionType } from "@/lib/admin/get-admin-user-restrictions";
import type { AdminTargetUser } from "@/app/admin/reports/[reportId]/page";

type Props = {
  report: AdminReportDetail;
  targetUsers: AdminTargetUser[];
};

const STATUS_LABELS: Record<ReportStatus, string> = {
  pending: "Pending",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

const RESTRICTION_LABELS: Record<RestrictionType, string> = {
  seller_suspended: "Seller Suspended",
  buyer_restricted: "Buyer Restricted",
  account_suspended: "Account Suspended",
};

const RESTRICTION_TYPES = Object.keys(RESTRICTION_LABELS) as RestrictionType[];

function activeRestrictions(restrictions: AdminUserRestriction[]): AdminUserRestriction[] {
  return restrictions.filter((r) => r.liftedAt === null);
}

function TargetUserPanel({ target, onChanged }: { target: AdminTargetUser; onChanged: (userId: string, restrictions: AdminUserRestriction[]) => void }) {
  const [restrictions, setRestrictions] = useState(target.restrictions);
  const [selectedType, setSelectedType] = useState<RestrictionType | "">("");
  const [confirmApply, setConfirmApply] = useState(false);
  const [confirmLiftId, setConfirmLiftId] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = activeRestrictions(restrictions);

  async function handleApply(reasonText: string) {
    if (selectedType === "") return;
    setIsPending(true);
    setError(null);

    const result = await applyUserRestriction(target.userId, selectedType, reasonText);
    setIsPending(false);

    if (!result.ok) {
      setError(APPLY_USER_RESTRICTION_ERROR_MESSAGES[result.code]);
      return;
    }

    setConfirmApply(false);
    setSelectedType("");
    const next = result.wasAlreadyActive
      ? restrictions
      : [
          {
            restrictionId: result.restrictionId,
            restrictionType: result.restrictionType,
            reason: reasonText,
            issuedBy: "",
            issuedByDisplayName: "You",
            createdAt: result.createdAt,
            liftedAt: null,
            liftedBy: null,
            liftedByDisplayName: null,
          },
          ...restrictions,
        ];
    setRestrictions(next);
    onChanged(target.userId, next);
  }

  async function handleLift(restrictionId: string) {
    setIsPending(true);
    setError(null);

    const result = await liftUserRestriction(restrictionId, null);
    setIsPending(false);

    if (!result.ok) {
      setError(LIFT_USER_RESTRICTION_ERROR_MESSAGES[result.code]);
      return;
    }

    setConfirmLiftId(null);
    const next = restrictions.map((r) => (r.restrictionId === restrictionId ? { ...r, liftedAt: result.liftedAt, liftedByDisplayName: "You" } : r));
    setRestrictions(next);
    onChanged(target.userId, next);
  }

  return (
    <div className="rounded-[14px] border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{target.displayName}</p>
        <span className="text-xs text-ink-muted">{target.roleLabel}</span>
      </div>

      {active.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {active.map((r) => (
            <li key={r.restrictionId} className="flex items-center justify-between gap-2 rounded-[10px] bg-canvas p-2.5">
              <div>
                <Badge tone="neutral">{RESTRICTION_LABELS[r.restrictionType]}</Badge>
                <p className="mt-1 text-xs text-ink-muted">{r.reason}</p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmLiftId(r.restrictionId)}
                disabled={isPending}
                className="h-8 shrink-0 rounded-[8px] border border-border px-3 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-60"
              >
                Lift
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-ink-muted">No active restrictions.</p>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <select
          aria-label={`Restriction type for ${target.displayName}`}
          value={selectedType}
          onChange={(event) => setSelectedType(event.target.value as RestrictionType)}
          className="h-9 flex-1 rounded-[8px] border border-border bg-canvas px-2 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <option value="">Choose a restriction…</option>
          {RESTRICTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {RESTRICTION_LABELS[type]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setConfirmApply(true)}
          disabled={selectedType === "" || isPending}
          className="h-9 shrink-0 rounded-[8px] bg-brand-action px-3 text-xs font-semibold text-brand-action-text hover:brightness-95 disabled:opacity-60"
        >
          Apply
        </button>
      </div>

      {confirmApply && selectedType !== "" && (
        <ConfirmDialog
          title={`Apply ${RESTRICTION_LABELS[selectedType]}?`}
          description={`This will restrict ${target.displayName}. A reason is required.`}
          confirmLabel="Apply Restriction"
          noteLabel="Reason"
          isPending={isPending}
          errorMessage={error}
          onConfirm={(note) => void handleApply(note)}
          onClose={() => setConfirmApply(false)}
        />
      )}

      {confirmLiftId && (
        <ConfirmDialog
          title="Lift this restriction?"
          description={`This restores ${target.displayName}'s privileges.`}
          confirmLabel="Lift Restriction"
          isPending={isPending}
          errorMessage={error}
          onConfirm={() => void handleLift(confirmLiftId)}
          onClose={() => setConfirmLiftId(null)}
        />
      )}
    </div>
  );
}

export function AdminReportDetailClient({ report, targetUsers }: Props) {
  const [status, setStatus] = useState(report.status);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState(targetUsers);

  async function handleResolve(nextStatus: Exclude<ReportStatus, "pending">) {
    setIsPending(true);
    setError(null);

    const result = await resolveAdminReport(report.reportId, nextStatus, null);
    setIsPending(false);

    if (!result.ok) {
      setError(RESOLVE_ADMIN_REPORT_ERROR_MESSAGES[result.code]);
      return;
    }

    setStatus(result.status);
  }

  function handleTargetChanged(userId: string, restrictions: AdminUserRestriction[]) {
    setUsers((prev) => prev.map((u) => (u.userId === userId ? { ...u, restrictions } : u)));
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-[14px] border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <Badge tone={status === "pending" ? "brand" : "neutral"}>{STATUS_LABELS[status]}</Badge>
          <span className="text-xs text-ink-muted">{formatOrderDate(report.createdAt)}</span>
        </div>

        {report.description && <p className="mt-3 text-sm text-ink">{report.description}</p>}

        <p className="mt-3 text-xs text-ink-muted">Reported by {report.reporterDisplayName}</p>

        {report.listingTitle && <p className="mt-1 text-sm text-ink-secondary">Listing: {report.listingTitle}</p>}
        {report.shopName && <p className="mt-1 text-sm text-ink-secondary">Shop: {report.shopName}</p>}
        {report.reviewBody && <p className="mt-1 text-sm text-ink-secondary">Review: {report.reviewBody}</p>}
        {report.conversationShopName && <p className="mt-1 text-sm text-ink-secondary">Conversation with: {report.conversationShopName}</p>}

        {report.resolvedByDisplayName && (
          <p className="mt-2 text-xs text-ink-muted">
            {STATUS_LABELS[status]} by {report.resolvedByDisplayName}
            {report.resolutionNote ? ` — ${report.resolutionNote}` : ""}
          </p>
        )}

        {error && <p className="mt-2 text-xs text-danger">{error}</p>}

        {status === "pending" && (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => void handleResolve("resolved")}
              disabled={isPending}
              className="h-9 flex-1 rounded-[8px] bg-brand-action px-3 text-xs font-semibold text-brand-action-text hover:brightness-95 disabled:opacity-60"
            >
              Mark Resolved
            </button>
            <button
              type="button"
              onClick={() => void handleResolve("dismissed")}
              disabled={isPending}
              className="h-9 flex-1 rounded-[8px] border border-border px-3 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-60"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {users.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-ink">Involved users</h2>
          <div className="mt-2 space-y-3">
            {users.map((target) => (
              <TargetUserPanel key={target.userId} target={target} onChanged={handleTargetChanged} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
