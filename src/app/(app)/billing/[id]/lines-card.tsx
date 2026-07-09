"use client";

import { useActionState, useEffect, useState } from "react";
import { Card } from "@/components/ui/primitives";
import { formatCurrency } from "@/lib/utils";
import { updateBillingLineAction, type BillingActionResult } from "../actions";

export interface EditableLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  prorationFactor: number;
  proratedDays: number | null;
  periodDays: number | null;
  discount: number;
  adjustment: number;
  estimatedCost: number | null;
  subtotal: number;
  total: number;
  taxStatus: string | null;
  qboItemId: string | null;
}

interface Props {
  lines: EditableLine[];
  /** True when the run is DRAFT and the user may edit lines. */
  editable: boolean;
  /** Whether the client has a matched QBO customer (for push eligibility). */
  hasQbo: boolean;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Line-items table with per-row inline editing on draft runs. */
export function LinesCard({ lines, editable, hasQbo }: Props) {
  const colCount = editable ? 10 : 9;
  const grandTotal = lines.reduce((a, l) => a + l.total, 0);
  const grandCost = lines.reduce((a, l) => a + (l.estimatedCost ?? 0), 0);
  const margin = grandTotal - grandCost;

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2 pr-4 font-medium">Description</th>
              <th className="py-2 pr-4 font-medium">Qty</th>
              <th className="py-2 pr-4 font-medium">Unit price</th>
              <th className="py-2 pr-4 font-medium">Proration</th>
              <th className="py-2 pr-4 font-medium">Disc / Adj</th>
              <th className="py-2 pr-4 font-medium">Subtotal</th>
              <th className="py-2 pr-4 font-medium">Tax</th>
              <th className="py-2 pr-4 font-medium">Total</th>
              <th className="py-2 pr-4 font-medium">Push eligibility</th>
              {editable && <th className="py-2 pr-4 font-medium sr-only">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) =>
              editable ? (
                <EditableRow key={l.id} line={l} hasQbo={hasQbo} colCount={colCount} />
              ) : (
                <StaticRow key={l.id} line={l} hasQbo={hasQbo} />
              ),
            )}
          </tbody>
          <tfoot>
            <tr className="border-t font-medium">
              <td className="py-2 pr-4" colSpan={7}>
                Grand total
              </td>
              <td className="py-2 pr-4 tabular-nums" colSpan={editable ? 3 : 2}>
                {formatCurrency(grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Estimated margin: {formatCurrency(margin)} (revenue {formatCurrency(grandTotal)} − est. cost{" "}
        {formatCurrency(grandCost)})
      </p>
    </Card>
  );
}

function PushEligibility({ line, hasQbo }: { line: EditableLine; hasQbo: boolean }) {
  const eligible = Boolean(line.qboItemId && hasQbo);
  return eligible ? (
    <span className="text-success">Eligible</span>
  ) : (
    <span className="text-danger">{hasQbo ? "No QBO item" : "No QBO customer"}</span>
  );
}

function StaticRow({ line, hasQbo }: { line: EditableLine; hasQbo: boolean }) {
  return (
    <tr className="border-t align-top">
      <td className="py-2 pr-4">{line.description}</td>
      <td className="py-2 pr-4 tabular-nums">{line.quantity}</td>
      <td className="py-2 pr-4 tabular-nums">{formatCurrency(line.unitPrice)}</td>
      <td className="py-2 pr-4 tabular-nums text-muted-foreground">
        {line.proratedDays != null && line.periodDays != null
          ? `${line.proratedDays}/${line.periodDays} d (${line.prorationFactor.toFixed(4)})`
          : "—"}
      </td>
      <td className="py-2 pr-4 tabular-nums">
        {formatCurrency(line.discount)} / {formatCurrency(line.adjustment)}
      </td>
      <td className="py-2 pr-4 tabular-nums">{formatCurrency(line.subtotal)}</td>
      <td className="py-2 pr-4">{line.taxStatus ?? "—"}</td>
      <td className="py-2 pr-4 font-medium tabular-nums">{formatCurrency(line.total)}</td>
      <td className="py-2 pr-4">
        <PushEligibility line={line} hasQbo={hasQbo} />
      </td>
    </tr>
  );
}

function EditableRow({
  line,
  hasQbo,
  colCount,
}: {
  line: EditableLine;
  hasQbo: boolean;
  colCount: number;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<BillingActionResult | null, FormData>(
    updateBillingLineAction,
    null,
  );

  // Draft field values for the live preview.
  const [description, setDescription] = useState(line.description);
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [unitPrice, setUnitPrice] = useState(String(line.unitPrice));
  const [discount, setDiscount] = useState(String(line.discount));
  const [adjustment, setAdjustment] = useState(String(line.adjustment));

  // Collapse back to view mode after a successful save (server data revalidated).
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  function reset() {
    setDescription(line.description);
    setQuantity(String(line.quantity));
    setUnitPrice(String(line.unitPrice));
    setDiscount(String(line.discount));
    setAdjustment(String(line.adjustment));
    setEditing(false);
  }

  if (!editing) {
    return (
      <tr className="border-t align-top">
        <td className="py-2 pr-4">{line.description}</td>
        <td className="py-2 pr-4 tabular-nums">{line.quantity}</td>
        <td className="py-2 pr-4 tabular-nums">{formatCurrency(line.unitPrice)}</td>
        <td className="py-2 pr-4 tabular-nums text-muted-foreground">
          {line.proratedDays != null && line.periodDays != null
            ? `${line.proratedDays}/${line.periodDays} d (${line.prorationFactor.toFixed(4)})`
            : "—"}
        </td>
        <td className="py-2 pr-4 tabular-nums">
          {formatCurrency(line.discount)} / {formatCurrency(line.adjustment)}
        </td>
        <td className="py-2 pr-4 tabular-nums">{formatCurrency(line.subtotal)}</td>
        <td className="py-2 pr-4">{line.taxStatus ?? "—"}</td>
        <td className="py-2 pr-4 font-medium tabular-nums">{formatCurrency(line.total)}</td>
        <td className="py-2 pr-4">
          <PushEligibility line={line} hasQbo={hasQbo} />
        </td>
        <td className="py-2 pr-4 text-right">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border px-2.5 py-1 text-xs font-medium transition hover:bg-accent"
          >
            Edit
          </button>
        </td>
      </tr>
    );
  }

  const qty = Number(quantity) || 0;
  const price = Number(unitPrice) || 0;
  const disc = Number(discount) || 0;
  const adj = Number(adjustment) || 0;
  const previewSubtotal = round2(qty * price * line.prorationFactor);
  const previewTotal = round2(previewSubtotal - disc + adj);

  return (
    <tr className="border-t bg-accent/30 align-top">
      <td colSpan={colCount} className="py-3 pr-4">
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="lineId" value={line.id} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="lg:col-span-5">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Description</span>
              <input
                name="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
                required
              />
            </label>
            <FieldNumber label="Qty" name="quantity" value={quantity} onChange={setQuantity} min={0} step="0.0001" />
            <FieldNumber label="Unit price" name="unitPrice" value={unitPrice} onChange={setUnitPrice} min={0} step="0.0001" />
            <FieldNumber label="Discount" name="discount" value={discount} onChange={setDiscount} min={0} step="0.01" />
            <FieldNumber label="Adjustment" name="adjustment" value={adjustment} onChange={setAdjustment} step="0.01" />
            <div className="flex flex-col justify-end">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Preview</span>
              <span className="tabular-nums text-sm">
                {formatCurrency(previewSubtotal)} sub ·{" "}
                <span className="font-medium">{formatCurrency(previewTotal)}</span> total
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Proration factor {line.prorationFactor.toFixed(4)} is kept from generation. Subtotal ={" "}
            qty × unit price × proration; total = subtotal − discount + adjustment.
          </p>
          {state && !state.ok && (
            <p className="rounded-md bg-danger/10 px-2.5 py-1.5 text-xs text-danger">{state.message}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save line"}
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-md border px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}

function FieldNumber({
  label,
  name,
  value,
  onChange,
  min,
  step,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  step?: string;
}) {
  return (
    <label>
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        name={name}
        value={value}
        min={min}
        step={step}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm tabular-nums"
        required
      />
    </label>
  );
}
