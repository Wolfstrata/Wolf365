"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { SfAgreementStatus, SfAgreementType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { safeErrorMessage } from "@/lib/redact";
import { recordChanges } from "@/lib/silverfang/change-log";
import { describeChanges } from "@/lib/silverfang/changes";
import { addMonths, increaseBy, renewalPreview } from "@/lib/silverfang/renewal";
import type { SfActionResult } from "./actions";

/**
 * Agreements: what pays for work. Block time draws down prepaid hours; managed
 * services and NOC bill recurring with an included-hours allowance; T&M bills as
 * worked. Every change is recorded in the SilverFang change trail.
 */

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;
const optionalId = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalMoney = z.preprocess(
  emptyToUndefined,
  z.coerce.number().min(0).max(100_000_000).optional(),
);
const optionalDate = z.preprocess(emptyToUndefined, z.coerce.date().optional());

function formValue(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
}

const agreementSchema = z.object({
  id: optionalId,
  clientId: z.string().min(1, "Select a client"),
  name: z.string().trim().min(1, "Name is required").max(200),
  type: z.enum(SfAgreementType),
  status: z.enum(SfAgreementStatus),
  startDate: z.coerce.date({ message: "A start date is required" }),
  endDate: optionalDate,
  autoRenew: z.coerce.boolean(),
  // The uplift applied when the agreement renews. Defaults to the house 15% when
  // left blank rather than to zero — a blank box should not quietly mean "no
  // increase" when the whole point of the field is that renewals go up.
  renewalIncreasePercent: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(0).max(100).optional(),
  ),
  billingFrequency: z.preprocess(emptyToUndefined, z.enum(["MONTHLY", "YEARLY"]).optional()),
  monthlyAmount: optionalMoney,
  includedHours: optionalMoney,
  overageRate: optionalMoney,
  standardRate: optionalMoney,
  notes: z.preprocess(emptyToUndefined, z.string().max(20_000).optional()),
  // Block time is bought as a quantity of hours. Captured on the agreement form
  // so creating one gives it a balance immediately, rather than leaving a
  // block-time agreement with zero hours until someone remembers step two.
  initialHours: z.preprocess(
    emptyToUndefined,
    z.coerce.number().gt(0).max(100_000).optional(),
  ),
  initialRate: optionalMoney,
  initialAmount: optionalMoney,
  initialExpiresAt: optionalDate,
});

const AGREEMENT_FIELDS = [
  "clientId",
  "name",
  "type",
  "status",
  "startDate",
  "endDate",
  "autoRenew",
  "renewalIncreasePercent",
  "billingFrequency",
  "monthlyAmount",
  "includedHours",
  "overageRate",
  "standardRate",
  "notes",
];

/** Create or update an agreement. */
export async function saveAgreementAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("agreements:manage");
  try {
    const input = agreementSchema.parse({
      id: formValue(formData, "id"),
      clientId: formValue(formData, "clientId"),
      name: formValue(formData, "name"),
      type: formValue(formData, "type"),
      status: formValue(formData, "status"),
      startDate: formValue(formData, "startDate"),
      endDate: formValue(formData, "endDate"),
      autoRenew: formData.get("autoRenew") === "on",
      renewalIncreasePercent: formValue(formData, "renewalIncreasePercent"),
      billingFrequency: formValue(formData, "billingFrequency"),
      monthlyAmount: formValue(formData, "monthlyAmount"),
      includedHours: formValue(formData, "includedHours"),
      overageRate: formValue(formData, "overageRate"),
      standardRate: formValue(formData, "standardRate"),
      notes: formValue(formData, "notes"),
      initialHours: formValue(formData, "initialHours"),
      initialRate: formValue(formData, "initialRate"),
      initialAmount: formValue(formData, "initialAmount"),
      initialExpiresAt: formValue(formData, "initialExpiresAt"),
    });

    if (input.endDate && input.endDate < input.startDate) {
      return { ok: false, message: "The end date cannot be before the start date." };
    }
    const client = await prisma.client.findUnique({
      where: { id: input.clientId },
      select: { id: true, name: true },
    });
    if (!client) return { ok: false, message: "That client no longer exists." };

    const data = {
      clientId: input.clientId,
      name: input.name,
      type: input.type,
      status: input.status,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      autoRenew: input.autoRenew,
      renewalIncreasePercent: input.renewalIncreasePercent ?? 15,
      billingFrequency: input.billingFrequency ?? null,
      monthlyAmount: input.monthlyAmount ?? null,
      includedHours: input.includedHours ?? null,
      overageRate: input.overageRate ?? null,
      standardRate: input.standardRate ?? null,
      notes: input.notes ?? null,
    };

    if (input.initialHours != null && input.type !== "BLOCK_TIME") {
      return {
        ok: false,
        message:
          "Purchased hours only apply to a Block time agreement — nothing would draw from them on this type.",
      };
    }
    if (
      input.initialExpiresAt &&
      input.initialHours != null &&
      input.initialExpiresAt <= input.startDate
    ) {
      return { ok: false, message: "The hours' expiry must be after the agreement start date." };
    }

    const before = input.id
      ? await prisma.sfAgreement.findUnique({ where: { id: input.id } })
      : null;
    const saved = input.id
      ? await prisma.sfAgreement.update({ where: { id: input.id }, data })
      : await prisma.sfAgreement.create({
          data: {
            ...data,
            createdById: user.id,
            createdByEmail: user.email,
            // The opening block is created with the agreement so its balance is
            // real from the moment it exists.
            ...(input.initialHours != null
              ? {
                  blocks: {
                    create: {
                      purchasedHours: input.initialHours,
                      rate: input.initialRate ?? null,
                      amount: input.initialAmount ?? null,
                      purchasedAt: input.startDate,
                      expiresAt: input.initialExpiresAt ?? null,
                    },
                  },
                }
              : {}),
          },
        });

    const changes = await recordChanges({
      entity: "SfAgreement",
      entityId: saved.id,
      entityLabel: `${client.name} — ${saved.name}`,
      actor: { id: user.id, email: user.email },
      before,
      after: saved as unknown as Record<string, unknown>,
      fields: AGREEMENT_FIELDS,
    });

    await audit({
      action: input.id ? "AGREEMENT_UPDATED" : "AGREEMENT_CREATED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfAgreement:${saved.id}`,
      metadata: { clientId: input.clientId, type: input.type, status: input.status },
    });
    revalidatePath("/silverfang/agreements");
    revalidatePath(`/silverfang/agreements/${saved.id}`);
    revalidatePath(`/silverfang/clients/${input.clientId}`);
    return {
      ok: true,
      message: input.id
        ? changes.length === 0
          ? "No changes to save."
          : `Saved ${describeChanges(changes)}.`
        : input.initialHours != null
          ? `Agreement created with ${input.initialHours}h of prepaid time.`
          : "Agreement created.",
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

const blockSchema = z.object({
  agreementId: z.string().min(1),
  purchasedHours: z.coerce.number().gt(0, "Purchased hours must be greater than zero").max(100_000),
  rate: optionalMoney,
  amount: optionalMoney,
  purchasedAt: z.coerce.date({ message: "A purchase date is required" }),
  expiresAt: optionalDate,
  poNumber: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
  notes: z.preprocess(emptyToUndefined, z.string().max(2_000).optional()),
});

/**
 * Add a block of prepaid hours. Only meaningful on a BLOCK_TIME agreement, so
 * adding one elsewhere is refused rather than silently creating hours nothing
 * will ever draw from.
 */
export async function addAgreementBlockAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("agreements:manage");
  try {
    const input = blockSchema.parse({
      agreementId: formValue(formData, "agreementId"),
      purchasedHours: formValue(formData, "purchasedHours"),
      rate: formValue(formData, "rate"),
      amount: formValue(formData, "amount"),
      purchasedAt: formValue(formData, "purchasedAt"),
      expiresAt: formValue(formData, "expiresAt"),
      poNumber: formValue(formData, "poNumber"),
      notes: formValue(formData, "notes"),
    });

    const agreement = await prisma.sfAgreement.findUnique({
      where: { id: input.agreementId },
      select: { id: true, type: true, name: true, clientId: true },
    });
    if (!agreement) return { ok: false, message: "That agreement no longer exists." };
    if (agreement.type !== "BLOCK_TIME") {
      return {
        ok: false,
        message:
          "Prepaid hour blocks only apply to a Block time agreement — nothing would ever draw from them here.",
      };
    }
    if (input.expiresAt && input.expiresAt <= input.purchasedAt) {
      return { ok: false, message: "The expiry date must be after the purchase date." };
    }

    const block = await prisma.sfAgreementBlock.create({
      data: {
        agreementId: input.agreementId,
        purchasedHours: input.purchasedHours,
        rate: input.rate ?? null,
        amount: input.amount ?? null,
        purchasedAt: input.purchasedAt,
        expiresAt: input.expiresAt ?? null,
        poNumber: input.poNumber ?? null,
        notes: input.notes ?? null,
      },
    });

    await recordChanges({
      entity: "SfAgreementBlock",
      entityId: block.id,
      entityLabel: `${agreement.name} — ${input.purchasedHours}h block`,
      actor: { id: user.id, email: user.email },
      before: null,
      after: block as unknown as Record<string, unknown>,
      fields: [],
    });
    await audit({
      action: "AGREEMENT_UPDATED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfAgreement:${input.agreementId}`,
      metadata: { blockAdded: input.purchasedHours, blockId: block.id },
    });
    revalidatePath(`/silverfang/agreements/${input.agreementId}`);
    revalidatePath(`/silverfang/clients/${agreement.clientId}`);
    return { ok: true, message: `Added ${input.purchasedHours}h of prepaid time.` };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/**
 * Delete an agreement. Refused once anything references it — tickets, time or
 * blocks with draws — because removing it would strip history of what paid for
 * the work. Cancelling is the reversible alternative and the message says so.
 */
export async function deleteAgreementAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("agreements:manage");
  try {
    const id = z.string().min(1).parse(formValue(formData, "id"));
    const agreement = await prisma.sfAgreement.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        clientId: true,
        _count: { select: { tickets: true, timeEntries: true, projects: true, blocks: true } },
      },
    });
    if (!agreement) return { ok: false, message: "That agreement no longer exists." };

    const { tickets, timeEntries, projects } = agreement._count;
    if (tickets + timeEntries + projects > 0) {
      return {
        ok: false,
        message:
          `This agreement is referenced by ${tickets} ticket(s), ${timeEntries} time entr(ies) ` +
          `and ${projects} project(s), so deleting it would strip that history of what paid for ` +
          `the work. Set its status to Cancelled instead.`,
      };
    }

    await prisma.sfAgreement.delete({ where: { id } });
    await recordChanges({
      entity: "SfAgreement",
      entityId: id,
      entityLabel: agreement.name,
      actor: { id: user.id, email: user.email },
      before: agreement as unknown as Record<string, unknown>,
      after: null,
      fields: [],
    });
    await audit({
      action: "AGREEMENT_UPDATED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfAgreement:${id}`,
      metadata: { deleted: true, name: agreement.name },
    });
    revalidatePath("/silverfang/agreements");
    revalidatePath(`/silverfang/clients/${agreement.clientId}`);
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
  redirect("/silverfang/agreements");
}

/**
 * Apply the auto-renew uplift: raise the agreement's recurring fee by its
 * configured percentage and roll the end date forward by one term.
 *
 * Only the recurring fee moves. Hourly rates are left alone — a rate is what the
 * work is worth and gets repriced on its own schedule, whereas the uplift is an
 * escalator on the contracted subscription. Raising both would turn one decision
 * into two price rises the client never agreed to.
 *
 * Deliberately manual. An agreement's renewal changes what a client pays, and a
 * price rise nobody approved reaching an invoice is how you lose the client — so
 * SilverFang computes and shows it, and a person decides. The same rule that
 * keeps invoices from auto-pushing applies here.
 *
 * Refused when the uplift has already been applied for this term, which is what
 * stops a second click from compounding 15% into 32%.
 */
export async function applyAgreementRenewalAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("agreements:manage");
  try {
    const id = z.string().min(1).parse(formValue(formData, "id"));
    const agreement = await prisma.sfAgreement.findUnique({
      where: { id },
      include: { client: { select: { name: true } } },
    });
    if (!agreement) return { ok: false, message: "That agreement no longer exists." };
    if (!agreement.autoRenew) {
      return {
        ok: false,
        message:
          "This agreement is not set to auto-renew, so there is no renewal uplift to apply. Tick auto-renew first if it should renew.",
      };
    }
    if (!agreement.endDate) {
      return {
        ok: false,
        message:
          "This agreement has no end date, so there is no term to renew. Set an end date first.",
      };
    }

    const percent = Number(agreement.renewalIncreasePercent);
    const preview = renewalPreview({
      autoRenew: agreement.autoRenew,
      renewalIncreasePercent: percent,
      startDate: agreement.startDate,
      endDate: agreement.endDate,
      lastRenewedAt: agreement.lastRenewedAt,
      billingFrequency: agreement.billingFrequency,
      monthlyAmount: agreement.monthlyAmount != null ? Number(agreement.monthlyAmount) : null,
      overageRate: agreement.overageRate != null ? Number(agreement.overageRate) : null,
      standardRate: agreement.standardRate != null ? Number(agreement.standardRate) : null,
    });
    if (preview.alreadyRenewed) {
      return {
        ok: false,
        message:
          "This term has already been renewed — applying the uplift again would compound it. The next renewal is due at the new end date.",
      };
    }

    const newEndDate = addMonths(agreement.endDate, preview.termMonths);
    const before = agreement;
    const saved = await prisma.sfAgreement.update({
      where: { id },
      data: {
        // The old end date becomes the new start of the term, so the history of
        // what the term was stays derivable from the dates.
        startDate: agreement.endDate,
        endDate: newEndDate,
        // The recurring fee only — overageRate and standardRate are untouched.
        monthlyAmount: increaseBy(
          agreement.monthlyAmount != null ? Number(agreement.monthlyAmount) : null,
          percent,
        ),
        lastRenewedAt: new Date(),
      },
    });

    await recordChanges({
      entity: "SfAgreement",
      entityId: id,
      entityLabel: `${agreement.client.name} — ${agreement.name}`,
      actor: { id: user.id, email: user.email },
      before: before as unknown as Record<string, unknown>,
      after: saved as unknown as Record<string, unknown>,
      fields: ["startDate", "endDate", "monthlyAmount", "lastRenewedAt"],
    });
    await audit({
      action: "AGREEMENT_UPDATED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfAgreement:${id}`,
      metadata: {
        renewed: true,
        percent,
        termMonths: preview.termMonths,
        newEndDate: newEndDate.toISOString(),
      },
    });
    revalidatePath("/silverfang/agreements");
    revalidatePath(`/silverfang/agreements/${id}`);
    revalidatePath(`/silverfang/clients/${agreement.clientId}`);

    const moved = preview.changes
      .map((c) => `${c.label} ${c.from} → ${c.to}`)
      .join(", ");
    return {
      ok: true,
      message:
        `Renewed at +${percent}% through ${newEndDate.toISOString().slice(0, 10)}.` +
        (moved
          ? ` ${moved}.`
          : " This agreement has no recurring fee, so only the term moved — hourly rates are not"
            + " changed by a renewal."),
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}
