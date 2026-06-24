import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/utils";
import { ROLE_LABELS, ROLE_DESCRIPTIONS, ASSIGNABLE_ROLES } from "@/lib/rbac";
import { UsersTable, type UserRow } from "./users-table";
import { setUserRoleAction, setUserDisabledAction } from "./users-actions";

/**
 * User management. Users are created automatically the first time someone signs
 * in with Microsoft 365 (as a Reviewer). Administrators assign roles and can
 * disable access here. Role changes apply on the user's next request; disabling
 * a user also revokes their active sessions immediately.
 */
export default async function UsersPage() {
  const me = await requirePermission("users:manage");

  const users = await prisma.user.findMany({
    orderBy: [{ disabled: "asc" }, { role: "asc" }, { email: "asc" }],
  });

  // Most recent LOGIN per user, for an at-a-glance "last seen".
  const lastLogins = await prisma.auditLog.groupBy({
    by: ["actorId"],
    where: { action: "LOGIN", actorId: { not: null } },
    _max: { createdAt: true },
  });
  const lastById = new Map(
    lastLogins.map((l) => [l.actorId, l._max.createdAt]),
  );

  const rows: UserRow[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    disabled: u.disabled,
    lastLogin: lastById.get(u.id)
      ? formatDateTime(lastById.get(u.id) ?? null, me.timezone)
      : null,
  }));

  return (
    <div>
      <PageHeader
        title="Users"
        description="Assign roles and manage access. Sign-in is via Microsoft 365 — new users appear here automatically as Reviewers."
      />
      <div className="space-y-6 p-8">
        <UsersTable
          users={rows}
          currentUserId={me.id}
          setRoleAction={setUserRoleAction}
          setDisabledAction={setUserDisabledAction}
        />

        <Card>
          <h2 className="text-sm font-semibold">What each role can do</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {ASSIGNABLE_ROLES.map((r) => (
              <div key={r} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="w-32 shrink-0 font-medium">{ROLE_LABELS[r]}</dt>
                <dd className="text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
