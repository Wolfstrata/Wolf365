"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  createSfBillingLineAction,
  deleteSfBillingLineAction,
  updateSfBillingLineAction,
  type SfBillingActionResult,
} from "../actions";
import { formatCurrency } from "@/lib/utils";
import { formatHours } from "@/lib/silverfang/time";

const inputCls =
  "w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export interface SfEditableLine {
  id: string;
  kind: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  adjustment: number;
  subtotal: number;
  total: number;
  estimatedCost: number | null;
  taxStatus: string | null;
  qboItemId: string | null;
  qboItemName: string | null;
  hoursVisible: boolean;
  timeEntryCount: number;
}

const KIND_LABELS: Record<string, string> = {
  TIME: "Time",
  OVERAGE: "Overage",
  RECURRING: "Recurring",
  BLOCK_PURCHASE: "Block purchase",
  PROJECT_FEE: "Project fee",
  PROJECT_DEPOSIT: "Deposit",
  MANUAL: "Manual",
};

/** Kinds whose quantity is hours rather than a count of periods. */
const HOUR_KINDS = new Set(["TIME", "OVERAGE", "BLOCK_PURCHASE"]);

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function SfLinesCard({
  runId,
  lines,
  editable,
  hasQbo,
  items,
}: {
  runId: string;
  lines: SfEditableLine[];
  editable: boolean;
  hasQbo: boolean;
  /** QuickBooks items to choose from when fixing an unmapped line. */
  items: { qboId: string; name: string }[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const colCount = editable ? 9 : 8;

  const grandTotal = lines.reduce((a, l) => a + l.total, 0);
  const cost = lines.reduce((a, l) => a + (l.estimatedCost ?? 0), 0);
  const hours = lines
    .filter((l) => HOUR_KINDS.has(l.kind))
    .reduce((a, l) => a + l.quantity, 0);
  const unmapped = lines.filter((l) => !l.qboItemId).length;

  if (lines.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This run has no lines. Nothing in the period was billable — the run&rsquo;s notes above
          say why.
        </p>
        {/* An empty run is the most likely place to want a hand-written line: the
            generator found nothing, but there is something to charge for. */}
        {editable &&
          (adding ? (
            <AddLineForm runId={runId} items={items} onDone={() => setAdding(false)} />
          ) : (
            <AddLineButton onClick={() => setAdding(true)} />
          ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {unmapped > 0 && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {unmapped} line{unmapped === 1 ? "" : "s"} ha{unmapped === 1 ? "s" : "ve"} no QuickBooks
          item. {unmapped === 1 ? "It" : "They"} will be <strong>skipped</strong> at push and the
          run will finish PARTIALLY FAILED — nothing is silently dropped, but nothing is billed for
          {unmapped === 1 ? " it" : " them"} either. Set an item on the line, or map the charge code
          under Item mapping.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 font-medium">Kind</th>
              <th className="py-1 pr-3 font-medium">Description</th>
              <th className="py-1 pr-3 text-right font-medium">Qty</th>
              <th className="py-1 pr-3 text-right font-medium">Unit</th>
              <th className="py-1 pr-3 text-right font-medium">Disc / Adj</th>
              <th className="py-1 pr-3 text-right font-medium">Subtotal</th>
              <th className="py-1 pr-3 text-right font-medium">Total</th>
              <th className="py-1 pr-3 font-medium">QuickBooks item</th>
              {editable && <th className="py-1 pr-3 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) =>
              editing === l.id && editable ? (
                <EditRow
                  key={l.id}
                  line={l}
                  items={items}
                  colCount={colCount}
                  onDone={() => setEditing(null)}
                />
              ) : (
                <tr key={l.id} className="border-t align-top">
                  <td className="py-1.5 pr-3">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      {KIND_LABELS[l.kind] ?? l.kind}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3">
                    {l.description}
                    {!l.hoursVisible && (
                      <span
                        className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground"
                        title="Hours behind this line are internal and are stripped from what QuickBooks receives."
                      >
                        hours internal
                      </span>
                    )}
                    {l.timeEntryCount > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {l.timeEntryCount} time entr{l.timeEntryCount === 1 ? "y" : "ies"}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {HOUR_KINDS.has(l.kind) ? formatHours(l.quantity) : l.quantity}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {formatCurrency(l.unitPrice)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                    {l.discount === 0 && l.adjustment === 0
                      ? "—"
                      : `${l.discount ? `-${formatCurrency(l.discount)}` : ""}${
                          l.adjustment ? ` +${formatCurrency(l.adjustment)}` : ""
                        }`}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {formatCurrency(l.subtotal)}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-medium tabular-nums">
                    {formatCurrency(l.total)}
                  </td>
                  <td className="py-1.5 pr-3">
                    {l.qboItemId ? (
                      <span className="text-xs">{l.qboItemName ?? l.qboItemId}</span>
                    ) : (
                      <span className="text-xs text-warning">not mapped — will be skipped</span>
                    )}
                  </td>
                  {editable && (
                    <td className="py-1.5 pr-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditing(l.id)}
                          className="rounded-md border px-2 py-0.5 text-xs font-medium transition hover:bg-accent"
                        >
                          Edit
                        </button>
                        {/* Only manual lines: a generated line is evidence of real
                            work, and the way to bill less for it is to adjust it. */}
                        {l.kind === "MANUAL" && <DeleteLineButton lineId={l.id} />}
                      </div>
                    </td>
                  )}
                </tr>
              ),
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 font-medium">
              <td className="py-2 pr-3" colSpan={6}>
                Total
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(grandTotal)}</td>
              <td colSpan={editable ? 2 : 1} />
            </tr>
          </tfoot>
        </table>
      </div>

      {editable &&
        (adding ? (
          <AddLineForm runId={runId} items={items} onDone={() => setAdding(false)} />
        ) : (
          <AddLineButton onClick={() => setAdding(true)} />
        ))}

      <p className="text-xs text-muted-foreground">
        {formatHours(hours)} billable hours on this run.
        {cost > 0 &&
          ` Estimated margin ${formatCurrency(grandTotal - cost)} (revenue ${formatCurrency(grandTotal)} − est. cost ${formatCurrency(cost)}).`}
        {!hasQbo &&
          " This client has no matched QuickBooks customer, so the run cannot be pushed yet."}
      </p>
    </div>
  );
}

function AddLineButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
    >
      <Plus className="h-3.5 w-3.5" />
      Add a line by hand
    </button>
  );
}

/**
 * Add a MANUAL line to a draft run.
 *
 * The kind is not offered as a choice. The generated kinds each assert where money
 * came from — this agreement's fee, these hours, that deposit — and a line typed in
 * by a person is not evidence of any of them.
 */
function AddLineForm({
  runId,
  items,
  onDone,
}: {
  runId: string;
  items: { qboId: string; name: string }[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<SfBillingActionResult | null, FormData>(
    createSfBillingLineAction,
    null,
  );
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [adjustment, setAdjustment] = useState("0");

  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const subtotal = round2(n(quantity) * n(unitPrice));
  const total = round2(subtotal - n(discount) + n(adjustment));

  return (
    <form action={action} className="space-y-3 rounded-md border bg-accent/30 p-3">
      <input type="hidden" name="runId" value={runId} />
      <p className="text-xs font-medium">New manual line</p>
      <label className="block text-xs font-medium">
        Description
        <input
          name="description"
          required
          maxLength={2000}
          placeholder="What is being charged for"
          className={`mt-1 ${inputCls}`}
        />
      </label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <label className="block text-xs font-medium">
          Qty
          <input
            type="number"
            step="0.01"
            min="0"
            name="quantity"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="block text-xs font-medium">
          Unit price
          <input
            type="number"
            step="0.01"
            min="0"
            name="unitPrice"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="block text-xs font-medium">
          Discount
          <input
            type="number"
            step="0.01"
            min="0"
            name="discount"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="block text-xs font-medium">
          Adjustment
          <input
            type="number"
            step="0.01"
            name="adjustment"
            value={adjustment}
            onChange={(e) => setAdjustment(e.target.value)}
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="block text-xs font-medium">
          QuickBooks item
          <select name="qboItemId" defaultValue="" className={`mt-1 ${inputCls}`}>
            {/* Blank falls back to whatever the MANUAL kind is mapped to, so the
                usual case needs no choice here. */}
            <option value="">Use the mapping for manual lines</option>
            {items.map((i) => (
              <option key={i.qboId} value={i.qboId}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        Preview: subtotal {formatCurrency(subtotal)} · total {formatCurrency(total)}. A manual line
        carries no cost, so it counts as pure margin — which is true of a charge nobody logged
        hours for.
      </p>

      {state && !state.ok && <p className="text-xs text-danger">{state.message}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          <Plus className="h-3.5 w-3.5" />
          {pending ? "Adding…" : "Add line"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Remove a manual line. Two-step, because a mis-click here changes an invoice. */
function DeleteLineButton({ lineId }: { lineId: string }) {
  const [state, action, pending] = useActionState<SfBillingActionResult | null, FormData>(
    deleteSfBillingLineAction,
    null,
  );
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title="Remove this manual line"
        className="rounded-md border px-2 py-0.5 text-xs font-medium text-danger transition hover:bg-danger/10"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="lineId" value={lineId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-danger px-2 py-0.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Removing…" : "Remove"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-md border px-2 py-0.5 text-xs font-medium transition hover:bg-accent"
      >
        No
      </button>
      {state && !state.ok && <span className="text-xs text-danger">{state.message}</span>}
    </form>
  );
}

function EditRow({
  line,
  items,
  colCount,
  onDone,
}: {
  line: SfEditableLine;
  items: { qboId: string; name: string }[];
  colCount: number;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<SfBillingActionResult | null, FormData>(
    updateSfBillingLineAction,
    null,
  );
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [unitPrice, setUnitPrice] = useState(String(line.unitPrice));
  const [discount, setDiscount] = useState(String(line.discount));
  const [adjustment, setAdjustment] = useState(String(line.adjustment));

  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const subtotal = round2(n(quantity) * n(unitPrice));
  const total = round2(subtotal - n(discount) + n(adjustment));

  return (
    <tr className="border-t bg-accent/30">
      <td colSpan={colCount} className="p-3">
        <form action={action} className="space-y-3">
          <input type="hidden" name="lineId" value={line.id} />
          <label className="block text-xs font-medium">
            Description
            <input
              name="description"
              defaultValue={line.description}
              required
              maxLength={2000}
              className={`mt-1 ${inputCls}`}
            />
          </label>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <label className="block text-xs font-medium">
              Qty
              <input
                type="number"
                step="0.01"
                min="0"
                name="quantity"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className={`mt-1 ${inputCls}`}
              />
            </label>
            <label className="block text-xs font-medium">
              Unit price
              <input
                type="number"
                step="0.01"
                min="0"
                name="unitPrice"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                className={`mt-1 ${inputCls}`}
              />
            </label>
            <label className="block text-xs font-medium">
              Discount
              <input
                type="number"
                step="0.01"
                min="0"
                name="discount"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                className={`mt-1 ${inputCls}`}
              />
            </label>
            <label className="block text-xs font-medium">
              Adjustment
              <input
                type="number"
                step="0.01"
                name="adjustment"
                value={adjustment}
                onChange={(e) => setAdjustment(e.target.value)}
                className={`mt-1 ${inputCls}`}
              />
            </label>
            <label className="block text-xs font-medium">
              QuickBooks item
              <select
                name="qboItemId"
                defaultValue={line.qboItemId ?? ""}
                className={`mt-1 ${inputCls}`}
              >
                <option value="">None — line will be skipped</option>
                {items.map((i) => (
                  <option key={i.qboId} value={i.qboId}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-xs text-muted-foreground">
            Preview: subtotal {formatCurrency(subtotal)} · total {formatCurrency(total)}
          </p>

          {state && !state.ok && <p className="text-xs text-danger">{state.message}</p>}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" />
              {pending ? "Saving…" : "Save line"}
            </button>
            <button
              type="button"
              onClick={onDone}
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
