"use client";

import { useActionState } from "react";
import { KeyRound, RefreshCw } from "lucide-react";
import { rotateEncryptionKeysAction, type SsoActionResult } from "./actions";

export interface RotationColumn {
  model: string;
  column: string;
  total: number;
  current: number;
  outstanding: number;
  legacy: number;
  plaintext: number;
  capped?: boolean;
  error?: string;
}

/**
 * Encryption-key status and the rotation control.
 *
 * The point of showing counts is that "have we finished rotating?" needs an
 * answer rather than a hope — dropping a retired key while values still depend on
 * it makes them permanently unreadable.
 */
export function RotateKeys({
  keyId,
  columns,
  outstanding,
  legacy,
  plaintext,
  complete,
  hasRetiredKeys,
  error,
}: {
  keyId: string;
  columns: RotationColumn[];
  outstanding: number;
  legacy: number;
  plaintext: number;
  complete: boolean;
  hasRetiredKeys: boolean;
  error?: string;
}) {
  const [result, action, pending] = useActionState<SsoActionResult | null, FormData>(
    rotateEncryptionKeysAction,
    null,
  );

  const failedColumns = columns.filter((c) => c.error);

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs">
          Encryption status is unavailable: {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <KeyRound className="h-4 w-4" /> Current key
        </span>
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{keyId}</code>
        {hasRetiredKeys ? (
          <span className="text-warning">
            A retired key is configured — a rotation is in progress.
          </span>
        ) : (
          <span className="text-muted-foreground">No retired keys configured.</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-1 pr-4 font-medium">Stored secret</th>
              <th className="py-1 pr-4 text-right font-medium">Values</th>
              <th className="py-1 pr-4 text-right font-medium">Current key</th>
              <th className="py-1 pr-4 text-right font-medium">Retired key</th>
              <th className="py-1 pr-4 text-right font-medium">Legacy (v1)</th>
              <th className="py-1 pr-4 text-right font-medium">Not encrypted</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => (
              <tr key={`${c.model}.${c.column}`} className="border-t">
                <td className="py-1.5 pr-4">
                  {c.model}.{c.column}
                  {c.capped && (
                    <span className="ml-1.5 text-xs text-muted-foreground">(first 5,000)</span>
                  )}
                </td>
                {c.error ? (
                  <td className="py-1.5 pr-4 text-danger" colSpan={5}>
                    Could not read: {c.error}
                  </td>
                ) : (
                  <>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{c.total}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{c.current}</td>
                    <td
                      className={`py-1.5 pr-4 text-right tabular-nums ${
                        c.outstanding > 0 ? "font-medium text-warning" : "text-muted-foreground"
                      }`}
                    >
                      {c.outstanding}
                    </td>
                    <td
                      className={`py-1.5 pr-4 text-right tabular-nums ${
                        c.legacy > 0 ? "font-medium text-warning" : "text-muted-foreground"
                      }`}
                    >
                      {c.legacy}
                    </td>
                    <td
                      className={`py-1.5 pr-4 text-right tabular-nums ${
                        c.plaintext > 0 ? "font-medium text-warning" : "text-muted-foreground"
                      }`}
                    >
                      {c.plaintext}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {failedColumns.length > 0 && (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs">
          {failedColumns.length} column(s) could not be read, so this report is incomplete and
          the retired key must not be removed yet. The usual cause is a migration that has not
          been applied — check <code>npm run db:status</code>.
        </p>
      )}

      {outstanding > 0 && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          {outstanding} stored value(s) are still encrypted under a retired key. Run the rotation
          until this reaches zero, then remove <code>WOLF365_ENCRYPTION_KEYS_OLD</code>. Removing it
          first would make those values permanently unreadable.
        </p>
      )}

      {legacy > 0 && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          {legacy} value(s) use the older v1 envelope, which carries no key fingerprint. They
          still decrypt, so nothing is broken — but which key opened them cannot be verified
          without trying, so a rotation cannot be called finished while any remain. The
          re-encryption below rewrites them as v2.
        </p>
      )}

      {plaintext > 0 && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          {plaintext} value(s) are stored in the clear — a column that was encrypted after its
          data was written. Reads tolerate this, so nothing is broken, but the data is not
          protected until you run the rotation below and this reaches zero.
        </p>
      )}

      {complete && (
        <p className="text-xs text-success">
          Everything is encrypted under the current key.
          {hasRetiredKeys && " WOLF365_ENCRYPTION_KEYS_OLD can now be removed."}
        </p>
      )}

      <form action={action}>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
          {pending ? "Re-encrypting…" : "Re-encrypt under the current key"}
        </button>
      </form>

      {result && (
        <p className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>{result.message}</p>
      )}

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">How to rotate the encryption key</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Generate a key: <code>openssl rand -base64 32</code>
          </li>
          <li>
            In Vercel, move the current <code>WOLF365_ENCRYPTION_KEY</code> value into{" "}
            <code>WOLF365_ENCRYPTION_KEYS_OLD</code>, then set the new key as{" "}
            <code>WOLF365_ENCRYPTION_KEY</code>. Deploy.
          </li>
          <li>
            Nothing breaks at this point — existing values still open with the retired key, and new
            writes use the new one.
          </li>
          <li>Press the button above until the retired-key count reaches zero.</li>
          <li>
            Remove <code>WOLF365_ENCRYPTION_KEYS_OLD</code> and deploy.
          </li>
        </ol>
      </details>
    </div>
  );
}
