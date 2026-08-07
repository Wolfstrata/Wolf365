"use client";

import { useActionState } from "react";
import { Save, Star, Trash2 } from "lucide-react";
import { saveContactAction, deleteContactAction, type SfActionResult } from "../actions";

const inputCls =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export interface ContactFormValues {
  id?: string;
  clientId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  mobile: string;
  title: string;
  isPrimary: boolean;
  vip: boolean;
  active: boolean;
  notes: string;
}

/**
 * Create/edit one contact. The email address is the field that matters most —
 * inbound ticket mail is matched to a client by the sender's address — so its
 * help text says so rather than leaving it looking optional-but-nice.
 */
export function ContactForm({
  values,
  clients,
  submitLabel,
  canDelete,
  source,
  lockedFromImport,
}: {
  values: ContactFormValues;
  clients: { id: string; name: string }[];
  submitLabel: string;
  canDelete: boolean;
  /** Where this contact came from, when it wasn't created here. */
  source?: string | null;
  /** True once a local edit has already detached it from the import. */
  lockedFromImport?: boolean;
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    saveContactAction,
    null,
  );
  const [deleteResult, deleteAction, deletePending] = useActionState<
    SfActionResult | null,
    FormData
  >(deleteContactAction, null);

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        {values.id && <input type="hidden" name="id" value={values.id} />}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Client <span className="text-danger">*</span>
            <select
              name="clientId"
              defaultValue={values.clientId}
              required
              className={`mt-1 ${inputCls}`}
            >
              <option value="">Select a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Job title
            <input
              name="title"
              defaultValue={values.title}
              placeholder="e.g. Office Manager"
              className={`mt-1 ${inputCls}`}
            />
          </label>
          <label className="block text-sm font-medium">
            First name <span className="text-danger">*</span>
            <input
              name="firstName"
              defaultValue={values.firstName}
              required
              maxLength={120}
              className={`mt-1 ${inputCls}`}
            />
          </label>
          <label className="block text-sm font-medium">
            Last name
            <input
              name="lastName"
              defaultValue={values.lastName}
              maxLength={120}
              className={`mt-1 ${inputCls}`}
            />
          </label>
          <label className="block text-sm font-medium sm:col-span-2">
            Email
            <input
              type="email"
              name="email"
              defaultValue={values.email}
              placeholder="name@client.com"
              className={`mt-1 ${inputCls}`}
            />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              How inbound ticket email is matched to this client. Without it, mail from this
              person can only be placed by their domain — or not at all. One address can
              belong to only one contact.
            </span>
          </label>
          <label className="block text-sm font-medium">
            Phone
            <input name="phone" defaultValue={values.phone} className={`mt-1 ${inputCls}`} />
          </label>
          <label className="block text-sm font-medium">
            Mobile
            <input name="mobile" defaultValue={values.mobile} className={`mt-1 ${inputCls}`} />
          </label>
        </div>

        <label className="block text-sm font-medium">
          Notes
          <textarea
            name="notes"
            defaultValue={values.notes}
            rows={3}
            className={`mt-1 ${inputCls}`}
          />
        </label>

        <div className="flex flex-wrap items-center gap-5">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isPrimary"
              defaultChecked={values.isPrimary}
              className="h-4 w-4"
            />
            Primary contact for this client
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" name="vip" defaultChecked={values.vip} className="h-4 w-4" />
            <Star className="h-3.5 w-3.5" />
            VIP
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="active"
              defaultChecked={values.active}
              className="h-4 w-4"
            />
            Active
          </label>
          <button
            type="submit"
            disabled={pending}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {pending ? "Saving…" : submitLabel}
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Unticking <span className="font-medium">Active</span> keeps the contact and its ticket
          history but removes it from the requester picker. Marking someone primary moves the
          flag off whoever held it. <span className="font-medium">VIP</span> lifts this
          person&rsquo;s tickets above others <em>at the same priority</em> — it never outranks
          priority itself, so a VIP&rsquo;s routine request cannot jump ahead of an outage.
        </p>

        {source && (
          <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-muted-foreground">
            Imported from <span className="font-medium text-foreground">{source}</span>.{" "}
            {lockedFromImport
              ? "It has been edited here, so SuperOps imports now leave it alone."
              : "Saving any change here detaches it — SuperOps imports will stop overwriting it from then on."}
          </p>
        )}

        {result && (
          <p className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>
            {result.message}
          </p>
        )}
      </form>

      {values.id && canDelete && (
        <form action={deleteAction} className="flex flex-wrap items-center gap-3 border-t pt-4">
          <input type="hidden" name="id" value={values.id} />
          <button
            type="submit"
            disabled={deletePending}
            className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            {deletePending ? "Deleting…" : "Delete contact"}
          </button>
          <span className="text-xs text-muted-foreground">
            Only possible while the contact has no tickets.
          </span>
          {deleteResult && (
            <span className={`text-sm ${deleteResult.ok ? "text-success" : "text-danger"}`}>
              {deleteResult.message}
            </span>
          )}
        </form>
      )}
    </div>
  );
}
