"use client";

import { useState, useTransition } from "react";
import { Role } from "@prisma/client";
import { ROLE_LABELS, ASSIGNABLE_ROLES } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import type { UserActionResult } from "./users-actions";

type Action = (
  prev: UserActionResult | null,
  formData: FormData,
) => Promise<UserActionResult>;

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  disabled: boolean;
  lastLogin: string | null;
}

interface Props {
  users: UserRow[];
  currentUserId: string;
  setRoleAction: Action;
  setDisabledAction: Action;
}

export function UsersTable({
  users,
  currentUserId,
  setRoleAction,
  setDisabledAction,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [result, setResult] = useState<UserActionResult | null>(null);

  function run(action: Action, fd: FormData, userId: string) {
    setBusyId(userId);
    startTransition(async () => {
      const r = await action(null, fd);
      setResult(r);
      setBusyId(null);
    });
  }

  function changeRole(userId: string, role: string) {
    const fd = new FormData();
    fd.set("userId", userId);
    fd.set("role", role);
    run(setRoleAction, fd, userId);
  }

  function toggleDisabled(userId: string, disabled: boolean) {
    const fd = new FormData();
    fd.set("userId", userId);
    fd.set("disabled", String(!disabled));
    run(setDisabledAction, fd, userId);
  }

  return (
    <div className="space-y-3">
      {result && (
        <p
          className={cn(
            "rounded-md px-3 py-2 text-sm",
            result.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger",
          )}
        >
          {result.message}
        </p>
      )}
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">User</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Last login</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              const rowBusy = pending && busyId === u.id;
              return (
                <tr
                  key={u.id}
                  className={cn("border-t align-middle", u.disabled && "opacity-60")}
                >
                  <td className="px-4 py-2">
                    <div className="font-medium">{u.name ?? u.email}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-4 py-2">
                    <select
                      aria-label={`Role for ${u.email}`}
                      value={u.role}
                      disabled={rowBusy}
                      onChange={(e) => changeRole(u.id, e.target.value)}
                      className="rounded-md border bg-background px-2 py-1 text-sm"
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {u.lastLogin ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    {u.disabled ? (
                      <span className="text-danger">Disabled</span>
                    ) : (
                      <span className="text-success">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      disabled={rowBusy || isSelf}
                      title={isSelf ? "You cannot disable your own account" : undefined}
                      onClick={() => toggleDisabled(u.id, u.disabled)}
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:opacity-40",
                        u.disabled
                          ? "hover:bg-success/10 hover:text-success"
                          : "hover:bg-danger/10 hover:text-danger",
                      )}
                    >
                      {u.disabled ? "Enable" : "Disable"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
