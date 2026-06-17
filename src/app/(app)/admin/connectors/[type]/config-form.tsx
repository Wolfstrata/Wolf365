"use client";

import { useActionState, useState } from "react";
import type { ConnectorView } from "@/lib/connectors/service";
import type { ActionResult } from "@/app/(app)/admin/connectors/actions";
import { cn } from "@/lib/utils";

type FormAction = (
  prev: ActionResult | null,
  formData: FormData,
) => Promise<ActionResult>;

interface Props {
  view: ConnectorView;
  canConfigure: boolean;
  canSync: boolean;
  saveAction: FormAction;
  testAction: FormAction;
  syncAction: FormAction;
  toggleAction: (formData: FormData) => Promise<void>;
}

function ResultBanner({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p
      className={cn(
        "rounded-md px-3 py-2 text-sm",
        result.ok
          ? "bg-success/10 text-success"
          : "bg-danger/10 text-danger",
      )}
    >
      {result.message}
    </p>
  );
}

export function ConnectorConfigForm({
  view,
  canConfigure,
  canSync,
  saveAction,
  testAction,
  syncAction,
  toggleAction,
}: Props) {
  const [saveState, save, saving] = useActionState(saveAction, null);
  const [testState, test, testing] = useActionState(testAction, null);
  const [syncState, sync, syncing] = useActionState(syncAction, null);

  const hasEnvironment = view.configFields.some((f) => f.key === "environment");
  const savedEnv = (view.configValues.environment as string) ?? "";
  // Track the selected environment so the banner updates as the user changes it.
  const [selectedEnv, setSelectedEnv] = useState(savedEnv);
  const envChanged = hasEnvironment && selectedEnv !== savedEnv;

  return (
    <div className="space-y-6">
      {/* Configuration form */}
      <form action={save} className="space-y-5 rounded-lg border bg-card p-6">
        <input type="hidden" name="type" value={view.type} />

        {hasEnvironment && (
          <div className="rounded-md border bg-muted/50 p-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Editing environment:</span>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  selectedEnv === "production"
                    ? "bg-danger/15 text-danger"
                    : selectedEnv === "sandbox"
                      ? "bg-warning/15 text-warning"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {selectedEnv ? selectedEnv.toUpperCase() : "NOT SELECTED"}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Sandbox and Production each keep their <strong>own</strong>{" "}
              credentials and connection. Switching the environment shows that
              environment&apos;s saved credentials — you don&apos;t lose the other.
            </p>
            {envChanged && (
              <p className="mt-1.5 text-xs text-warning">
                You changed the environment to{" "}
                <strong>{selectedEnv || "—"}</strong>. Click{" "}
                <strong>Save configuration</strong> to load/edit its credentials.
              </p>
            )}
          </div>
        )}

        {view.configFields.map((f) => (
          <Field key={f.key} label={f.label} required={f.required} help={f.helpText}>
            {f.type === "select" ? (
              <select
                name={`config.${f.key}`}
                defaultValue={(view.configValues[f.key] as string) ?? ""}
                disabled={!canConfigure}
                onChange={
                  f.key === "environment"
                    ? (e) => setSelectedEnv(e.target.value)
                    : undefined
                }
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Select…</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                name={`config.${f.key}`}
                defaultValue={(view.configValues[f.key] as string) ?? ""}
                disabled={!canConfigure}
                placeholder={f.placeholder}
                rows={3}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            ) : (
              <input
                type="text"
                name={`config.${f.key}`}
                defaultValue={(view.configValues[f.key] as string) ?? ""}
                disabled={!canConfigure}
                placeholder={f.placeholder}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            )}
          </Field>
        ))}

        {view.secretFields.map((f) => {
          const stored = view.secretsSet[f.key];
          const envSuffix =
            hasEnvironment && savedEnv ? ` for ${savedEnv.toUpperCase()}` : "";
          return (
            <Field
              key={f.key}
              label={
                stored ? `${f.label} — saved ✓${envSuffix}` : f.label
              }
              required={f.required && !stored}
              help={f.helpText}
            >
              <input
                type="password"
                name={`secret.${f.key}`}
                autoComplete="new-password"
                disabled={!canConfigure}
                placeholder={
                  stored
                    ? `•••••••• saved${envSuffix} — leave blank to keep`
                    : `Not set${envSuffix} — enter value`
                }
                className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
              />
            </Field>
          );
        })}

        <ResultBanner result={saveState} />

        {canConfigure && (
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save configuration"}
          </button>
        )}
      </form>

      {/* Operations */}
      <div className="rounded-lg border bg-card p-6">
        <h3 className="text-sm font-semibold">Operations</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Test Connection and Sync Now perform real calls against the live API.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {canConfigure && (
            <form action={test}>
              <input type="hidden" name="type" value={view.type} />
              <button
                type="submit"
                disabled={testing}
                className="rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
              >
                {testing ? "Testing…" : "Test Connection"}
              </button>
            </form>
          )}
          {canSync && (
            <form action={sync}>
              <input type="hidden" name="type" value={view.type} />
              <button
                type="submit"
                disabled={syncing}
                className="rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
              >
                {syncing ? "Syncing…" : "Sync Now"}
              </button>
            </form>
          )}
          {canConfigure && (
            <form action={toggleAction}>
              <input type="hidden" name="type" value={view.type} />
              <input
                type="hidden"
                name="enabled"
                value={(!view.enabled).toString()}
              />
              <button
                type="submit"
                className="rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-accent"
              >
                {view.enabled ? "Disable" : "Enable"}
              </button>
            </form>
          )}
        </div>
        <div className="mt-4 space-y-2">
          <ResultBanner result={testState} />
          <ResultBanner result={syncState} />
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  help,
  children,
}: {
  label: string;
  required?: boolean;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="ml-1 text-danger">*</span>}
      </label>
      {children}
      {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
