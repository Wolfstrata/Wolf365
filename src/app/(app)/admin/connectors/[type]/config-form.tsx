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
        result.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger",
      )}
    >
      {result.message}
    </p>
  );
}

const str = (v: unknown): string => (v == null ? "" : String(v));

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

  const envField = view.configFields.find((f) => f.key === "environment");
  const otherFields = view.configFields.filter((f) => f.key !== "environment");

  // Active environment toggle. Switching it repopulates the (non-secret) fields
  // from that environment's saved config and updates the secret-status labels.
  const [env, setEnv] = useState(view.activeEnv);

  // Controlled values for non-secret config fields, seeded from the active env.
  const seed = (e: string): Record<string, string> => {
    const cfg = view.envScoped ? (view.envConfig[e] ?? {}) : view.configValues;
    const out: Record<string, string> = {};
    for (const f of otherFields) out[f.key] = str(cfg[f.key]);
    return out;
  };
  const [values, setValues] = useState<Record<string, string>>(seed(view.activeEnv));

  const secretsSetForEnv = view.envScoped
    ? (view.envSecretsSet[env] ?? {})
    : view.secretsSet;

  function switchEnv(next: string) {
    setEnv(next);
    setValues(seed(next)); // autopopulate this environment's saved fields
  }

  function setField(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  return (
    <div className="space-y-6">
      <form action={save} className="space-y-5 rounded-lg border bg-card p-6">
        <input type="hidden" name="type" value={view.type} />

        {/* Environment toggle */}
        {envField && (
          <div>
            <label className="mb-1.5 block text-sm font-medium">Environment</label>
            <input type="hidden" name="config.environment" value={env} />
            <div className="inline-flex rounded-md border p-0.5">
              {envField.options?.map((o) => {
                const active = env === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    disabled={!canConfigure}
                    onClick={() => switchEnv(o.value)}
                    className={cn(
                      "rounded px-4 py-1.5 text-sm font-medium capitalize transition",
                      active
                        ? o.value === "production"
                          ? "bg-danger text-white"
                          : "bg-warning text-white"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {o.value}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Each environment keeps its own settings and credentials. Switching
              the toggle loads that environment&apos;s saved values automatically.
              {envField.helpText ? ` ${envField.helpText}` : ""}
            </p>
          </div>
        )}

        {/* Non-secret config fields (controlled, so the toggle can repopulate) */}
        {otherFields.map((f) => (
          <Field key={f.key} label={f.label} required={f.required} help={f.helpText}>
            {f.type === "select" ? (
              <select
                name={`config.${f.key}`}
                value={values[f.key] ?? ""}
                disabled={!canConfigure}
                onChange={(e) => setField(f.key, e.target.value)}
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
                value={values[f.key] ?? ""}
                disabled={!canConfigure}
                placeholder={f.placeholder}
                rows={3}
                onChange={(e) => setField(f.key, e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            ) : (
              <input
                type="text"
                name={`config.${f.key}`}
                value={values[f.key] ?? ""}
                disabled={!canConfigure}
                placeholder={f.placeholder}
                onChange={(e) => setField(f.key, e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            )}
          </Field>
        ))}

        {/* Secret fields — write-only; show saved status for the active env */}
        {view.secretFields.map((f) => {
          const stored = secretsSetForEnv[f.key];
          const envSuffix = view.envScoped ? ` for ${env.toUpperCase()}` : "";
          return (
            <Field
              key={`${env}-${f.key}`}
              label={stored ? `${f.label} — saved ✓${envSuffix}` : f.label}
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
          Test Connection and Sync Now perform real calls against the live API
          for the saved environment.
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
              <input type="hidden" name="enabled" value={(!view.enabled).toString()} />
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
