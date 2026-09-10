import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getAdminUsers } from "@/lib/admin/get-admin-users";
import { AdminRoleManagementClient } from "@/components/admin/AdminRoleManagementClient";

export const metadata = { title: "Admins | Admin | Preshopps" };

/**
 * Super-admin-only role-management surface (PRD 4.5/ARCHITECTURE S8).
 * Same authorization posture as every other admin page -- get_admin_users
 * (0078) is the sole source of truth, checked against public.user_roles
 * server-side; any caller who is not specifically a super_admin (a guest,
 * an ordinary user, or an ordinary admin) gets the exact same notFound()
 * the other admin pages give a non-admin, never a distinguishable
 * "access denied" page and never exposed in the shared admin nav for
 * anyone but a super_admin (see the "Admins" tab on /admin, /admin/support,
 * /admin/disputes, each gated on getMyAdminRole()).
 */
export default async function AdminAdminsPage() {
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent("/admin/admins")}`);
  }

  const result = await getAdminUsers();

  if (result.status === "not_super_admin") {
    notFound();
  }

  if (result.status === "error") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <p className="text-sm text-ink-secondary">Unable to load admins right now.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-xl font-bold text-ink lg:text-2xl">Admins</h1>
      <p className="mt-1 text-sm text-ink-secondary">Manage admin and super admin access. Super admin only.</p>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        <Link
          href="/admin"
          className="flex h-8 shrink-0 items-center rounded-full border border-border bg-surface px-3 text-xs font-medium text-ink-secondary hover:border-brand-link hover:text-brand-link"
        >
          Reports
        </Link>
        <Link
          href="/admin/support"
          className="flex h-8 shrink-0 items-center rounded-full border border-border bg-surface px-3 text-xs font-medium text-ink-secondary hover:border-brand-link hover:text-brand-link"
        >
          Support
        </Link>
        <Link
          href="/admin/disputes"
          className="flex h-8 shrink-0 items-center rounded-full border border-border bg-surface px-3 text-xs font-medium text-ink-secondary hover:border-brand-link hover:text-brand-link"
        >
          Disputes
        </Link>
        <Link
          href="/admin/admins"
          aria-current="page"
          className="flex h-8 shrink-0 items-center rounded-full bg-brand-action px-3 text-xs font-semibold text-brand-action-text"
        >
          Admins
        </Link>
      </div>

      <div className="mt-6">
        <AdminRoleManagementClient currentUserId={user.id} initialUsers={result.users} />
      </div>
    </div>
  );
}
