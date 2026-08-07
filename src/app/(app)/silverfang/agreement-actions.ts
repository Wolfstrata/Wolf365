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
import {
  checkAuthorized,
  normalizeTechIds,
} from "@/lib/silverfang/authorized-techs";
import { applyAgreementRenewal } from "@/lib/silverfang/renewal-service";
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

    // An authorised-tech list restricts editing as well as logging time, and it
    // restricts everyone — a role that quietly bypasses it prevents no accidents.
    // The escape hatch is not a bypass: the tech list itself stays editable by
    // anyone who can configure SilverFang, and that edit is audited.
    if (input.id) {
      const refusal = await agreementEditRefusal(input.id, user.id);
      if (refusal) return { ok: false, message: refusal };
    }
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
 * Apply the auto-renew uplift now, from the agreement page.
 *
 * The cron applies renewals on the due date automatically; this exists for
 * renewing early, or for catching one up after its agreement was edited. Both
 * paths run the same code in `renewal-service.ts`, so they cannot diverge.
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
      select: { clientId: true },
    });
    // requireDue is false: a human may renew before the term ends, and the UI
    // says as much next to the button.
    const outcome = await applyAgreementRenewal(id, { id: user.id, email: user.email });
    if (!outcome.ok) return { ok: false, message: outcome.reason ?? "Could not renew." };

    revalidatePath("/silverfang/agreements");
    revalidatePath(`/silverfang/agreements/${id}`);
    if (agreement) revalidatePath(`/silverfang/clients/${agreement.clientId}`);

    const moved =
      outcome.from != null && outcome.to != null
        ? ` Recurring amount ${outcome.from} → ${outcome.to}.`
        : " This agreement has no recurring fee, so only the term moved — hourly rates are not changed by a renewal.";
    return {
      ok: true,
      message: `Renewed at +${outcome.percent}% through ${outcome.newEndDate?.toISOString().slice(0, 10)}.${moved}`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/**
 * The refusal message when this user may not edit an agreement, or null when they
 * may.
 *
 * Reads the list fresh rather than taking it from the form: an authorisation check
 * against browser-supplied state is not a check.
 */
async function agreementEditRefusal(
  agreementId: string,
  userId: string,
): Promise<string | null> {
  const agreement = await prisma.sfAgreement.findUnique({
    where: { id: agreementId },
    select: { name: true, authorizedTechs: { select: { userId: true } } },
  });
  if (!agreement) return null;
  const verdict = checkAuthorized(
    {
      kind: "agreement",
      name: agreement.name,
      authorizedUserIds: agreement.authorizedTechs.map((t) => t.userId),
    },
    userId,
  );
  return verdict.allowed ? null : verdict.reason;
}

/**
 * Replace an agreement's authorised technicians.
 *
 * Deliberately NOT subject to the restriction it manages — that would make a
 * restricted agreement permanently uneditable by anyone left off the list, which
 * is a lockout, not a safeguard. `silverfang:configure` is the gate, and every
 * change is audited with who granted what.
 *
 * Empty means everyone. Saving an empty list removes the restriction, and the
 * result message says so rather than leaving it to be inferred.
 */
export async function saveAgreementTechsAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("silverfang:configure");
  try {
    const agreementId = z.string().min(1).parse(formValue(formData, "agreementId"));
    const userIds = normalizeTechIds(formData.getAll("userIds").map(String));

    const agreement = await prisma.sfAgreement.findUnique({
      where: { id: agreementId },
      select: { id: true, name: true },
    });
    if (!agreement) return { ok: false, message: "That agreement no longer exists." };

    // Only real, enabled users — a stale id would silently authorise nobody while
    // making the agreement look restricted.
    const valid = await prisma.user.findMany({
      where: { id: { in: userIds }, disabled: false },
      select: { id: true },
    });
    const validIds = valid.map((v) => v.id);

    await prisma.$transaction([
      prisma.sfAgreementTech.deleteMany({ where: { agreementId } }),
      ...(validIds.length > 0
        ? [
            prisma.sfAgreementTech.createMany({
              data: validIds.map((id) => ({
                agreementId,
                userId: id,
                grantedById: user.id,
                grantedByEmail: user.email,
              })),
            }),
          ]
        : []),
    ]);

    await audit({
      action: "AGREEMENT_UPDATED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfAgreement:${agreementId}`,
      metadata: { authorizedTechs: validIds, dropped: userIds.length - validIds.length },
    });
    revalidatePath(`/silverfang/agreements/${agreementId}`);
    revalidatePath("/silverfang/agreements");
    return {
      ok: true,
      message:
        validIds.length === 0
          ? "Restriction removed — every technician can log time against this agreement."
          : `${validIds.length} technician(s) authorised. Nobody else can log time against ` +
            `this agreement or edit it, though they can still open and read it.`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}
