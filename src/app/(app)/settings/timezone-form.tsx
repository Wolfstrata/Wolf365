"use client";

import { useActionState } from "react";
import { cn } from "@/lib/utils";
import { saveTimezoneAction, type SettingsResult } from "./actions";

/** Common IANA timezones; the field also accepts any value the runtime supports. */
const COMMON_ZONES = [
  "America/Toronto",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Vancouver",
  "America/Halifax",
  "America/St_Johns",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Australia/Sydney",
];

export function TimezoneForm({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState<
    SettingsResult | null,
    FormData
  >(saveTimezoneAction, null);

  // Browser's detected timezone, offered as a convenient default.
  const detected =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC";

  const options = Array.from(new Set([detected, ...COMMON_ZONES])).filter(Boolean);

  return (
    <form action={action} className="max-w-lg space-y-4 rounded-lg border bg-card p-6">
      <div>
        <label className="mb-1 block text-sm font-medium">Timezone</label>
        <select
          name="timezone"
          defaultValue={current ?? ""}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">UTC (default)</option>
          {options.map((z) => (
            <option key={z} value={z}>
              {z}
              {z === detected ? " — detected" : ""}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          Timestamps in audit and debug logs (and elsewhere) will display in this
          timezone. Your browser detected <strong>{detected}</strong>.
        </p>
      </div>

      {state && (
        <p
          className={cn(
            "rounded-md px-3 py-2 text-sm",
            state.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger",
          )}
        >
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save timezone"}
      </button>
    </form>
  );
}
