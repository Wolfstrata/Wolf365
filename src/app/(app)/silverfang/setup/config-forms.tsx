"use client";

import { useActionState, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  addHolidayAction,
  deleteHolidayAction,
  deleteRateRuleAction,
  saveBusinessHoursAction,
  saveChargeCodeAction,
  saveRateRuleAction,
  saveSlaTargetsAction,
} from "../setup-actions";
import type { SfActionResult } from "../actions";
import {
  CHARGE_CODE_KIND_LABELS,
  PRIORITY_LABELS,
  RATE_SCOPE_LABELS,
  TIME_BAND_LABELS,
} from "@/lib/silverfang/constants";

const inputCls =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

function Result({ result }: { result: SfActionResult | null }) {
  if (!result) return null;
  return (
    <span className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>
      {result.message}
    </span>
  );
}

export interface ChargeCodeRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  billableDefault: boolean;
  defaultMultiplier: number | null;
  sortOrder: number;
  active: boolean;
  inUse: number;
}

/** Charge codes: what kind of work a time entry is. */
export function ChargeCodeEditor({ codes }: { codes: ChargeCodeRow[] }) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    saveChargeCodeAction,
    null,
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const current = codes.find((c) => c.id === editing) ?? null;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-1 pr-4 font-medium">Code</th>
              <th className="py-1 pr-4 font-medium">Name</th>
              <th className="py-1 pr-4 font-medium">Kind</th>
              <th className="py-1 pr-4 font-medium">Billable</th>
              <th className="py-1 pr-4 text-right font-medium">Multiplier</th>
              <th className="py-1 pr-4 text-right font-medium">Used</th>
              <th className="py-1 pr-4 font-medium" />
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="py-1.5 pr-4 font-mono">{c.code}</td>
                <td className="py-1.5 pr-4">{c.name}</td>
                <td className="py-1.5 pr-4">
                  {CHARGE_CODE_KIND_LABELS[c.kind as keyof typeof CHARGE_CODE_KIND_LABELS] ?? c.kind}
                </td>
                <td className="py-1.5 pr-4">{c.billableDefault ? "Yes" : "No"}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums">
                  {c.defaultMultiplier != null ? `×${c.defaultMultiplier}` : "—"}
                </td>
                <td className="py-1.5 pr-4 text-right tabular-nums">{c.inUse}</td>
                <td className="py-1.5 pr-4">
                  {!c.active && (
                    <span className="mr-2 text-xs text-muted-foreground">inactive</span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(c.id);
                      setAdding(false);
                    }}
                    className="rounded-md border px-2 py-0.5 text-xs font-medium transition hover:bg-accent"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!adding && !editing && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium transition hover:bg-accent"
        >
          <Plus className="h-4 w-4" /> Add charge code
        </button>
      )}

      {(adding || editing) && (
        <form action={action} className="space-y-3 rounded-md border p-3">
          {current && <input type="hidden" name="id" value={current.id} />}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            <label className="block text-xs font-medium">
              Code <span className="text-danger">*</span>
              <input
                name="code"
                defaultValue={current?.code ?? ""}
                required
                className={`mt-1 font-mono ${inputCls}`}
              />
            </label>
            <label className="block text-xs font-medium sm:col-span-2">
              Name <span className="text-danger">*</span>
              <input
                name="name"
                defaultValue={current?.name ?? ""}
                required
                className={`mt-1 ${inputCls}`}
              />
            </label>
            <label className="block text-xs font-medium">
              Kind
              <select
                name="kind"
                defaultValue={current?.kind ?? "BILLABLE_WORK"}
                className={`mt-1 ${inputCls}`}
              >
                {Object.entries(CHARGE_CODE_KIND_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium">
              Multiplier
              <input
                type="number"
                step="0.05"
                min="0"
                name="defaultMultiplier"
                defaultValue={current?.defaultMultiplier ?? ""}
                placeholder="e.g. 1.5"
                className={`mt-1 ${inputCls}`}
              />
            </label>
            <label className="block text-xs font-medium">
              Order
              <input
                type="number"
                min="0"
                name="sortOrder"
                defaultValue={current?.sortOrder ?? 0}
                className={`mt-1 ${inputCls}`}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="billableDefault"
                defaultChecked={current?.billableDefault ?? true}
                className="h-4 w-4"
              />
              Billable by default
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="active"
                defaultChecked={current?.active ?? true}
                className="h-4 w-4"
              />
              Active
            </label>
            <Result result={result} />
            <button
              type="submit"
              disabled={pending}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setAdding(false);
              }}
              className="rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            A multiplier scales whatever base rate resolves — that&rsquo;s how after-hours work
            bills at 1.5× without duplicating every rate. Deactivating keeps history and removes
            the code from new entries.
          </p>
        </form>
      )}
    </div>
  );
}

export interface RateRuleRow {
  id: string;
  scope: string;
  client: string | null;
  agreement: string | null;
  chargeCode: string | null;
  timeBand: string;
  fixedRate: number | null;
  multiplier: number | null;
  costRate: number | null;
  active: boolean;
}

/** Rate rules, most specific first — the order `resolveRate` applies them in. */
export function RateRuleEditor({
  rules,
  clients,
  agreements,
  chargeCodes,
}: {
  rules: RateRuleRow[];
  clients: { id: string; name: string }[];
  agreements: { id: string; label: string }[];
  chargeCodes: { id: string; code: string }[];
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    saveRateRuleAction,
    null,
  );
  const [adding, setAdding] = useState(false);
  const [scope, setScope] = useState("GLOBAL");

  const needsClient = scope === "CLIENT" || scope === "CLIENT_SERVICE";
  const needsAgreement = scope === "AGREEMENT" || scope === "AGREEMENT_SERVICE";
  const needsCode =
    scope === "SERVICE" || scope === "CLIENT_SERVICE" || scope === "AGREEMENT_SERVICE";

  return (
    <div className="space-y-3">
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No rate rules, so logged time only gets a value from an agreement&rsquo;s standard rate
          or a technician&rsquo;s own rate. Add a Global rule to give everything a floor.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-1 pr-4 font-medium">Scope</th>
                <th className="py-1 pr-4 font-medium">Applies to</th>
                <th className="py-1 pr-4 font-medium">When</th>
                <th className="py-1 pr-4 text-right font-medium">Rate</th>
                <th className="py-1 pr-4 text-right font-medium">×</th>
                <th className="py-1 pr-4 text-right font-medium">Cost</th>
                <th className="py-1 pr-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-1.5 pr-4">
                    {RATE_SCOPE_LABELS[r.scope as keyof typeof RATE_SCOPE_LABELS] ?? r.scope}
                  </td>
                  <td className="py-1.5 pr-4 text-muted-foreground">
                    {[r.client, r.agreement, r.chargeCode].filter(Boolean).join(" · ") || "Everything"}
                  </td>
                  <td className="py-1.5 pr-4">
                    {TIME_BAND_LABELS[r.timeBand as keyof typeof TIME_BAND_LABELS] ?? r.timeBand}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{r.fixedRate ?? "—"}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {r.multiplier != null ? `×${r.multiplier}` : "—"}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{r.costRate ?? "—"}</td>
                  <td className="py-1.5 pr-4">
                    {!r.active && <span className="mr-2 text-xs text-muted-foreground">off</span>}
                    <form action={deleteRateRuleAction} className="inline">
                      <input type="hidden" name="id" value={r.id} />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1 rounded-md border border-danger/40 px-2 py-0.5 text-xs font-medium text-danger transition hover:bg-danger/10"
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium transition hover:bg-accent"
        >
          <Plus className="h-4 w-4" /> Add rate rule
        </button>
      ) : (
        <form action={action} className="space-y-3 rounded-md border p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="block text-xs font-medium">
              Scope
              <select
                name="scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className={`mt-1 ${inputCls}`}
              >
                {Object.entries(RATE_SCOPE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {needsClient && (
              <label className="block text-xs font-medium">
                Client
                <select name="clientId" required className={`mt-1 ${inputCls}`}>
                  <option value="">Select…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {needsAgreement && (
              <label className="block text-xs font-medium">
                Agreement
                <select name="agreementId" required className={`mt-1 ${inputCls}`}>
                  <option value="">Select…</option>
                  {agreements.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {needsCode && (
              <label className="block text-xs font-medium">
                Charge code
                <select name="chargeCodeId" required className={`mt-1 ${inputCls}`}>
                  <option value="">Select…</option>
                  {chargeCodes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block text-xs font-medium">
              When
              <select name="timeBand" defaultValue="ANY" className={`mt-1 ${inputCls}`}>
                {Object.entries(TIME_BAND_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium">
              Fixed rate
              <input
                type="number"
                step="0.01"
                min="0"
                name="fixedRate"
                className={`mt-1 ${inputCls}`}
              />
            </label>
            <label className="block text-xs font-medium">
              Multiplier
              <input
                type="number"
                step="0.05"
                min="0"
                name="multiplier"
                className={`mt-1 ${inputCls}`}
              />
            </label>
            <label className="block text-xs font-medium">
              Cost rate
              <input
                type="number"
                step="0.01"
                min="0"
                name="costRate"
                className={`mt-1 ${inputCls}`}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked className="h-4 w-4" />
              Active
            </label>
            <Result result={result} />
            <button
              type="submit"
              disabled={pending}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {pending ? "Saving…" : "Save rule"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            The most specific matching rule wins, in this order: agreement+code, agreement,
            client+code, client, code, global. A band-specific rule beats an &ldquo;any
            time&rdquo; one, and a multiplier scales the next-less-specific base rate.
          </p>
        </form>
      )}
    </div>
  );
}

export interface SlaTargetRow {
  priority: string;
  kind: string;
  minutes: number;
}

/** SLA response/resolution targets, in business minutes. */
export function SlaTargetEditor({
  slaId,
  targets,
}: {
  slaId: string;
  targets: SlaTargetRow[];
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    saveSlaTargetsAction,
    null,
  );
  const value = (p: string, k: string) =>
    targets.find((t) => t.priority === p && t.kind === k)?.minutes ?? "";

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="slaId" value={slaId} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-1 pr-4 font-medium">Priority</th>
              <th className="py-1 pr-4 font-medium">Response (min)</th>
              <th className="py-1 pr-4 font-medium">Resolution (min)</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(PRIORITY_LABELS).map(([p, label]) => (
              <tr key={p} className="border-t">
                <td className="py-1.5 pr-4">{label}</td>
                <td className="py-1.5 pr-4">
                  <input
                    type="number"
                    min="1"
                    name={`target_${p}_RESPONSE`}
                    defaultValue={value(p, "RESPONSE")}
                    className={`w-28 ${inputCls}`}
                  />
                </td>
                <td className="py-1.5 pr-4">
                  <input
                    type="number"
                    min="1"
                    name={`target_${p}_RESOLUTION`}
                    defaultValue={value(p, "RESOLUTION")}
                    className={`w-28 ${inputCls}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">
          Counted in business minutes, so a 240-minute target spans two days when only four
          working hours remain. Changing a target does not move due dates on existing tickets.
        </span>
        <Result result={result} />
        <button
          type="submit"
          disabled={pending}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {pending ? "Saving…" : "Save targets"}
        </button>
      </div>
    </form>
  );
}

/** Business hours and holidays — what the SLA clock actually counts. */
export function CalendarEditor({
  slaId,
  weekdays,
  startMinute,
  endMinute,
  timezone,
  holidays,
}: {
  slaId: string;
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  timezone: string;
  holidays: { id: string; name: string; date: string }[];
}) {
  const [hoursResult, hoursAction, savingHours] = useActionState<SfActionResult | null, FormData>(
    saveBusinessHoursAction,
    null,
  );
  const [holidayResult, holidayAction, addingHoliday] = useActionState<
    SfActionResult | null,
    FormData
  >(addHolidayAction, null);

  const toTime = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  return (
    <div className="space-y-5">
      <form action={hoursAction} className="space-y-3">
        <input type="hidden" name="slaId" value={slaId} />
        <div className="flex flex-wrap items-center gap-3">
          {WEEKDAYS.map((d) => (
            <label key={d.value} className="inline-flex cursor-pointer items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="weekdays"
                value={d.value}
                defaultChecked={weekdays.includes(d.value)}
                className="h-4 w-4"
              />
              {d.label}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block text-xs font-medium">
            Day starts
            <input
              type="time"
              name="startMinute_display"
              defaultValue={toTime(startMinute)}
              onChange={(e) => {
                const hidden = e.currentTarget.form?.elements.namedItem(
                  "startMinute",
                ) as HTMLInputElement | null;
                const [h, m] = e.currentTarget.value.split(":");
                if (hidden) hidden.value = String(Number(h) * 60 + Number(m));
              }}
              className={`mt-1 ${inputCls}`}
            />
            <input type="hidden" name="startMinute" defaultValue={startMinute} />
          </label>
          <label className="block text-xs font-medium">
            Day ends
            <input
              type="time"
              name="endMinute_display"
              defaultValue={toTime(endMinute)}
              onChange={(e) => {
                const hidden = e.currentTarget.form?.elements.namedItem(
                  "endMinute",
                ) as HTMLInputElement | null;
                const [h, m] = e.currentTarget.value.split(":");
                if (hidden) hidden.value = String(Number(h) * 60 + Number(m));
              }}
              className={`mt-1 ${inputCls}`}
            />
            <input type="hidden" name="endMinute" defaultValue={endMinute} />
          </label>
          <label className="block text-xs font-medium sm:col-span-2">
            Timezone
            <input
              name="timezone"
              defaultValue={timezone}
              placeholder="America/Winnipeg"
              className={`mt-1 ${inputCls}`}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">
            An unrecognised timezone is refused rather than silently falling back to UTC, which
            would shift every SLA calculation.
          </span>
          <Result result={hoursResult} />
          <button
            type="submit"
            disabled={savingHours}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {savingHours ? "Saving…" : "Save hours"}
          </button>
        </div>
      </form>

      <div className="border-t pt-4">
        <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
          Holidays ({holidays.length})
        </h4>
        {holidays.length > 0 && (
          <ul className="mb-3 space-y-1 text-sm">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center gap-2">
                <span className="tabular-nums text-muted-foreground">{h.date}</span>
                <span>{h.name}</span>
                <form action={deleteHolidayAction} className="ml-auto">
                  <input type="hidden" name="id" value={h.id} />
                  <button
                    type="submit"
                    className="rounded-md border px-2 py-0.5 text-xs transition hover:bg-accent"
                  >
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={holidayAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="slaId" value={slaId} />
          <label className="block text-xs font-medium">
            Date
            <input type="date" name="date" required className={`mt-1 ${inputCls}`} />
          </label>
          <label className="block text-xs font-medium">
            Name
            <input name="name" required placeholder="e.g. Canada Day" className={`mt-1 ${inputCls}`} />
          </label>
          <button
            type="submit"
            disabled={addingHoliday}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            {addingHoliday ? "Adding…" : "Add holiday"}
          </button>
          <Result result={holidayResult} />
        </form>
      </div>
    </div>
  );
}
