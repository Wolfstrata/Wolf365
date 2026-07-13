"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, X } from "lucide-react";
import type { Role } from "@prisma/client";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/lib/rbac";
import { setViewAsAction } from "@/app/(app)/view-as-actions";

/**
 * Administrator "View as" role picker (footer). Lets an admin preview the app as
 * any role — nav, screens, and permissions all reflect the chosen role — then
 * switch back to Administrator. Only rendered for real administrators; the
 * server action re-checks the true role, so this is a convenience, not the gate.
 */
export function ViewAsControl({ effectiveRole }: { effectiveRole: Role }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const change = (role: string) => {
    startTransition(async () => {
      await setViewAsAction(role);
      router.refresh();
    });
  };

  return (
    <label className="mt-2 flex items-center gap-2 rounded-md px-2 text-xs text-muted-foreground">
      <Eye className="h-3.5 w-3.5 shrink-0" />
      <span className="shrink-0">View as</span>
      <select
        value={effectiveRole}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        aria-label="Preview the app as a role"
        className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-xs text-foreground disabled:opacity-60"
      >
        {ASSIGNABLE_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Sticky banner shown while an administrator is previewing as another role, with
 * a one-click exit back to Administrator.
 */
export function ViewAsBanner({ role }: { role: Role }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const exit = () => {
    startTransition(async () => {
      await setViewAsAction("ADMINISTRATOR");
      router.refresh();
    });
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning">
      <span className="flex items-center gap-2">
        <Eye className="h-4 w-4 shrink-0" />
        Viewing as <strong>{ROLE_LABELS[role]}</strong> — you are seeing the app as
        this role.
      </span>
      <button
        type="button"
        onClick={exit}
        disabled={pending}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-warning/40 px-2.5 py-1 text-xs font-medium transition hover:bg-warning/20 disabled:opacity-60"
      >
        <X className="h-3.5 w-3.5" /> Exit to Administrator
      </button>
    </div>
  );
}
