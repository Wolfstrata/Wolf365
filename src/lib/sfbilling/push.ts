import "server-only";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { buildContext } from "@/connectors/runtime";
import { connectorFetch } from "@/connectors/http";
import { getQboEndpoints } from "@/connectors/quickbooks/discovery";
import {
  getValidAccessToken,
  qboApiBase,
  type QboEnvironment,
  type QboSecrets,
} from "@/connectors/quickbooks/oauth";
import { safeErrorMessage } from "@/lib/redact";
import { assertTransition, canPush } from "./state";

/**
 * Push a SilverFang billing run to QuickBooks Online as one invoice.
 *
 * Two rules govern this file, and both are deliberate:
 *
 * 1. Nothing is pushed automatically. The run must be APPROVED (or a
 *    PARTIALLY_FAILED retry) and a human must have triggered it.
 * 2. A line with no mapped QBO item is SKIPPED, never silently dropped, and the
 *    run lands in PARTIALLY_FAILED so somebody has to look at it. An invoice that
 *    quietly went out short is worse than one that flagged itself.
 *
 * On success the consumed time entries are marked INVOICED in the same
 * transaction as the run update, so a crash cannot leave hours that were billed
 * looking billable.
 */

export interface SfPushResult {
  ok: boolean;
  qboInvoiceId?: string;
  pushedLines: number;
  skippedLines: number;
  message: string;
}

/**
 * The description that goes to QuickBooks. For a line whose hours must stay
 * internal, any hours are stripped — the client sees what they bought, not how
 * long it took.
 */
export function invoiceDescription(line: {
  description: string;
  hoursVisible: boolean;
}): string {
  if (line.hoursVisible) return line.description;
  return line.description.replace(/\s*[—-]\s*\d+(\.\d+)?\s*h(ours)?\b/gi, "");
}

export async function pushSfBillingRunToQbo(
  runId: string,
  actor: { id: string; email: string },
): Promise<SfPushResult> {
  const run = await prisma.sfBillingRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      client: { select: { name: true, qboCustomer: { select: { qboId: true } } } },
      lines: { include: { timeEntries: { select: { timeEntryId: true } } } },
    },
  });

  if (!canPush(run.status)) {
    throw new Error(
      `A SilverFang billing run can only be pushed once approved — this one is ${run.status}.`,
    );
  }
  const qboCustomerId = run.client.qboCustomer?.qboId;
  if (!qboCustomerId) {
    throw new Error(
      `${run.client.name} is not matched to a QuickBooks customer, so there is nowhere to send the invoice.`,
    );
  }

  const eligible = run.lines.filter((l) => l.qboItemId);
  const skipped = run.lines.length - eligible.length;
  if (eligible.length === 0) {
    throw new Error(
      "No line on this run has a mapped QuickBooks item. Map the charge codes and line kinds in SilverFang Billing settings first.",
    );
  }

  const fromStatus = run.status;
  try {
    const connector = await prisma.connector.findUniqueOrThrow({
      where: { type: "QUICKBOOKS_ONLINE" },
    });
    const ctx = await buildContext(connector);
    const secrets = ctx.secrets as QboSecrets;
    const env = ((ctx.config.environment as string) ?? "sandbox") as QboEnvironment;
    const { tokenEndpoint } = await getQboEndpoints(env);
    const accessToken = await getValidAccessToken(
      secrets,
      (next) => ctx.saveSecrets(next as Record<string, unknown>),
      tokenEndpoint,
    );

    const payload = {
      CustomerRef: { value: qboCustomerId },
      TxnDate: run.invoiceDate.toISOString().slice(0, 10),
      Line: eligible.map((l) => ({
        DetailType: "SalesItemLineDetail",
        Amount: Number(l.total),
        Description: invoiceDescription(l),
        SalesItemLineDetail: {
          ItemRef: { value: l.qboItemId! },
          Qty: Number(l.quantity),
          UnitPrice: Number(l.unitPrice),
        },
      })),
      PrivateNote:
        `Wolf365 SilverFang billing run ${run.id} ` +
        `(${run.periodStart.toISOString().slice(0, 10)} – ${run.periodEnd.toISOString().slice(0, 10)})`,
    };

    const res = await connectorFetch(
      `${qboApiBase(env)}/v3/company/${secrets.realmId}/invoice?minorversion=73`,
      {
        connectorType: "QUICKBOOKS_ONLINE",
        connectorId: connector.id,
        environment: env,
        action: "push_sf_invoice",
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        correlationHeader: "intuit_tid",
      },
    );
    if (!res.ok) {
      throw new Error(`QuickBooks rejected the invoice (HTTP ${res.status})`);
    }
    const qboInvoiceId =
      (JSON.parse(res.body) as { Invoice?: { Id?: string } }).Invoice?.Id ?? null;

    const finalStatus = skipped > 0 ? "PARTIALLY_FAILED" : "PUSHED";
    if (fromStatus !== finalStatus) assertTransition(fromStatus, finalStatus);

    const pushedLineIds = eligible.map((l) => l.id);
    const consumedEntryIds = eligible.flatMap((l) => l.timeEntries.map((t) => t.timeEntryId));
    const blockIds = eligible
      .filter((l) => l.kind === "BLOCK_PURCHASE" && l.blockId)
      .map((l) => l.blockId as string);
    const depositProjectIds = eligible
      .filter((l) => l.kind === "PROJECT_DEPOSIT" && l.projectId)
      .map((l) => l.projectId as string);
    const feeLines = eligible.filter((l) => l.kind === "PROJECT_FEE" && l.projectId);
    const now = new Date();

    // Advance each fixed-fee watermark by exactly the periods billed — never to
    // "now" — so a gap between runs cannot swallow an unbilled period.
    const feeProjects =
      feeLines.length > 0
        ? await prisma.sfProject.findMany({
            where: { id: { in: feeLines.map((l) => l.projectId as string) } },
            select: {
              id: true,
              startDate: true,
              billingIntervalDays: true,
              feeBilledThroughAt: true,
            },
          })
        : [];
    const feeWatermarks = feeLines
      .map((l) => {
        const p = feeProjects.find((fp) => fp.id === l.projectId);
        const anchor = p?.feeBilledThroughAt ?? p?.startDate;
        if (!p || !anchor) return null;
        const days = p.billingIntervalDays > 0 ? p.billingIntervalDays : 30;
        const advanced = new Date(
          anchor.getTime() + Number(l.quantity) * days * 86_400_000,
        );
        return { id: p.id, feeBilledThroughAt: advanced };
      })
      .filter((w): w is { id: string; feeBilledThroughAt: Date } => w !== null);

    await prisma.$transaction([
      prisma.sfBillingRun.update({
        where: { id: runId },
        data: {
          status: finalStatus,
          pushedAt: now,
          qboInvoiceId,
          pushError:
            skipped > 0
              ? `${skipped} line(s) skipped — no mapped QuickBooks item. They were not billed.`
              : null,
        },
      }),
      prisma.sfBillingLine.updateMany({
        where: { id: { in: pushedLineIds } },
        data: { qboInvoiceId },
      }),
      // Hours that were billed must stop looking billable, or the next run bills
      // them again.
      ...(consumedEntryIds.length > 0
        ? [
            prisma.sfTimeEntry.updateMany({
              where: { id: { in: consumedEntryIds } },
              data: { status: "INVOICED", invoicedAt: now, qboInvoiceId },
            }),
          ]
        : []),
      // Same idempotency for the one-off charges.
      ...(blockIds.length > 0
        ? [
            prisma.sfAgreementBlock.updateMany({
              where: { id: { in: blockIds } },
              data: { invoicedAt: now, qboInvoiceId },
            }),
          ]
        : []),
      ...(depositProjectIds.length > 0
        ? [
            prisma.sfProject.updateMany({
              where: { id: { in: depositProjectIds } },
              data: { depositInvoicedAt: now },
            }),
          ]
        : []),
      ...feeWatermarks.map((w) =>
        prisma.sfProject.update({
          where: { id: w.id },
          data: { feeBilledThroughAt: w.feeBilledThroughAt },
        }),
      ),
    ]);

    await audit({
      action: "QBO_INVOICE_PUSHED",
      actorId: actor.id,
      actorEmail: actor.email,
      target: `sfBillingRun:${runId}`,
      metadata: {
        source: "silverfang",
        qboInvoiceId,
        pushedLines: eligible.length,
        skipped,
        timeEntries: consumedEntryIds.length,
      },
    });

    return {
      ok: skipped === 0,
      qboInvoiceId: qboInvoiceId ?? undefined,
      pushedLines: eligible.length,
      skippedLines: skipped,
      message:
        skipped > 0
          ? `Invoice ${qboInvoiceId ?? "(id unknown)"} created, but ${skipped} line(s) were skipped for having no mapped QuickBooks item. They have NOT been billed — map them and run again.`
          : `Invoice ${qboInvoiceId ?? "(id unknown)"} created in QuickBooks with ${eligible.length} line(s).`,
    };
  } catch (err) {
    const message = safeErrorMessage(err);
    await prisma.sfBillingRun.update({
      where: { id: runId },
      data: { status: "PARTIALLY_FAILED", pushError: message },
    });
    await audit({
      action: "QBO_INVOICE_PUSHED",
      actorId: actor.id,
      actorEmail: actor.email,
      target: `sfBillingRun:${runId}`,
      metadata: { source: "silverfang", error: message },
    });
    return {
      ok: false,
      pushedLines: 0,
      skippedLines: run.lines.length,
      message: `Push failed: ${message}. Nothing was billed; the run can be retried.`,
    };
  }
}
