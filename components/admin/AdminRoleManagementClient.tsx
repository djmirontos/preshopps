"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/seller/ConfirmDialog";
import { formatOrderDate } from "@/lib/orders/format-order-date";
import {
  findUserForRoleAssignment,
  grantAdminRole,
  revokeAdminRole,
  FIND_USER_FOR_ROLE_ASSIGNMENT_ERROR_MESSAGES,
  GRANT_ADMIN_ROLE_ERROR_MESSAGES,
  REVOKE_ADMIN_ROLE_ERROR_MESSAGES,
  type FoundUserForRoleAssignment,
} from "@/lib/admin/admin-role-actions";
import type { AdminUserSummary } from "@/lib/admin/get-admin-users";
import type { AdminRole } from "@/lib/admin/get-my-admin-role";

const ROLE_LABELS: Record<AdminRole, string> = {
  admin: "Admin",
  super_admin: "Super Admin",
};

type Props = {
  currentUserId: string;
  initialUsers: AdminUserSummary[];
};

/**
 * Super-admin-only role-management workspace (PRD 4.5/ARCHITECTURE S8):
 * search an existing user by email (find_user_for_role_assignment, 0078
 * -- never a general user directory), grant/change their role, and a
 * roster of current admins/super_admins with a safe removal control.
 * Every mutation calls router.refresh() on success so this component's
 * props resync from the server, matching AdminDisputeDetailClient's own
 * convention. Lockout protection (can't remove/demote the last remaining
 * super_admin) is enforced server-side (0078) -- this component only
 * surfaces the resulting LAST_SUPER_ADMIN error message; it does not
 * duplicate that logic client-side.
 */
export function AdminRoleManagementClient({ currentUserId, initialUsers: users }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<FoundUserForRoleAssignment | null | undefined>(undefined);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AdminUserSummary | null>(null);

  async function handleSearch() {
    setIsSearching(true);
    setSearchError(null);
    setSearchResult(undefined);

    const result = await findUserForRoleAssignment(email.trim());
    setIsSearching(false);

    if (!result.ok) {
      setSearchError(FIND_USER_FOR_ROLE_ASSIGNMENT_ERROR_MESSAGES[result.code]);
      return;
    }

    setSearchResult(result.user);
  }

  async function handleGrant(userId: string, role: AdminRole) {
    setPendingAction(`grant:${userId}:${role}`);
    setActionError(null);

    const result = await grantAdminRole(userId, role);
    setPendingAction(null);

    if (!result.ok) {
      setActionError(GRANT_ADMIN_ROLE_ERROR_MESSAGES[result.code]);
      return;
    }

    setEmail("");
    setSearchResult(undefined);
    router.refresh();
  }

  async function handleRevoke(reason: string) {
    if (!revokeTarget) return;
    setPendingAction(`revoke:${revokeTarget.userId}`);
    setActionError(null);

    const result = await revokeAdminRole(revokeTarget.userId, reason || undefined);
    setPendingAction(null);

    if (!result.ok) {
      setActionError(REVOKE_ADMIN_ROLE_ERROR_MESSAGES[result.code]);
      return;
    }

    setRevokeTarget(null);
    router.refresh();
  }

  return (
    <div>
      <div className="rounded-[14px] border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink">Add an admin</h2>
        <p className="mt-1 text-xs text-ink-secondary">Search for an existing account by email, then assign a role.</p>

        <div className="mt-3 flex gap-2">
          <label htmlFor="admin-search-email" className="sr-only">
            Email address
          </label>
          <input
            id="admin-search-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="person@example.com"
            className="h-10 flex-1 rounded-[10px] border border-border bg-canvas px-3 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
          <button
            type="button"
            onClick={() => void handleSearch()}
            disabled={isSearching || email.trim().length === 0}
            className="h-10 shrink-0 rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 disabled:opacity-60"
          >
            {isSearching ? "Searching…" : "Search"}
          </button>
        </div>

        {searchError && <p className="mt-2 text-sm text-danger">{searchError}</p>}

        {searchResult === null && <p className="mt-2 text-sm text-ink-secondary">No user found with that email.</p>}

        {searchResult && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-[10px] bg-canvas p-3">
            <div>
              <p className="text-sm font-semibold text-ink">{searchResult.displayName}</p>
              <p className="text-xs text-ink-secondary">{searchResult.email}</p>
              {searchResult.currentRole && (
                <p className="mt-0.5 text-xs text-ink-muted">Currently {ROLE_LABELS[searchResult.currentRole]}</p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              {searchResult.currentRole !== "admin" && (
                <button
                  type="button"
                  onClick={() => void handleGrant(searchResult.userId, "admin")}
                  disabled={pendingAction !== null}
                  className="h-9 rounded-[10px] border border-border bg-surface px-3 text-xs font-semibold text-ink hover:border-brand-link disabled:opacity-60"
                >
                  Make Admin
                </button>
              )}
              {searchResult.currentRole !== "super_admin" && (
                <button
                  type="button"
                  onClick={() => void handleGrant(searchResult.userId, "super_admin")}
                  disabled={pendingAction !== null}
                  className="h-9 rounded-[10px] bg-brand-action px-3 text-xs font-semibold text-brand-action-text hover:brightness-95 disabled:opacity-60"
                >
                  Make Super Admin
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {actionError && !revokeTarget && <p className="mt-3 text-sm text-danger">{actionError}</p>}

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-ink">Current admins</h2>
        <ul className="mt-2 space-y-2">
          {users.map((user) => {
            const isSelf = user.userId === currentUserId;
            return (
              <li
                key={user.userId}
                className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-surface p-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-ink">{user.displayName}</p>
                    {isSelf && <span className="text-xs text-ink-muted">(you)</span>}
                    <Badge tone={user.role === "super_admin" ? "brand" : "neutral"}>{ROLE_LABELS[user.role]}</Badge>
                  </div>
                  <p className="text-xs text-ink-secondary">{user.email}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {user.grantedByDisplayName ? `Granted by ${user.grantedByDisplayName}` : "Granted by system bootstrap"} ·{" "}
                    {formatOrderDate(user.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {user.role !== "admin" && (
                    <button
                      type="button"
                      onClick={() => void handleGrant(user.userId, "admin")}
                      disabled={pendingAction !== null}
                      className="h-9 rounded-[10px] border border-border bg-surface px-3 text-xs font-semibold text-ink hover:border-brand-link disabled:opacity-60"
                    >
                      Make Admin
                    </button>
                  )}
                  {user.role !== "super_admin" && (
                    <button
                      type="button"
                      onClick={() => void handleGrant(user.userId, "super_admin")}
                      disabled={pendingAction !== null}
                      className="h-9 rounded-[10px] border border-border bg-surface px-3 text-xs font-semibold text-ink hover:border-brand-link disabled:opacity-60"
                    >
                      Make Super Admin
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setRevokeTarget(user)}
                    disabled={pendingAction !== null}
                    className="h-9 rounded-[10px] border border-danger px-3 text-xs font-semibold text-danger hover:bg-danger/5 disabled:opacity-60"
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {revokeTarget && (
        <ConfirmDialog
          title={`Remove ${revokeTarget.displayName}'s admin access?`}
          description="This immediately removes their admin/super admin access. This can't be undone from here -- they would need to be re-added."
          confirmLabel="Remove access"
          destructive
          isPending={pendingAction === `revoke:${revokeTarget.userId}`}
          errorMessage={actionError}
          onConfirm={handleRevoke}
          onClose={() => setRevokeTarget(null)}
        />
      )}
    </div>
  );
}
