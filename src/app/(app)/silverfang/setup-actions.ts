"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SfChargeCodeKind, SfRateScope, SfTimeBand } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { safeErrorMessage } from "@/lib/redact";
import type { SfActionResult } from "./actions";

/** Service-desk configuration: charge codes, rate rules, SLA targets and calendar. */

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;
const optionalId = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalMoney = z.preprocess(
  emptyToUndefined,
  z.coerce.number().min(0).max(1_000_000).optional(),
);

function formValue(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
}

// --- Charge codes ----------------------------------------------------------

const chargeCodeSchema = z.object({
  id: optionalId,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, "A code is required")
    .max(40)
    .regex(/^[A-Z0-9_-]+$/, "Use letters, numbers, hyphens and underscores only"),
  name: z.string().trim().min(1, "A name is required").max(120),
  kind: z.enum(SfChargeCodeKind),
  billableDefault: z.coerce.boolean(),
  defaultMultiplier: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(0).max(10).optional(),
  ),
  sortOrder: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(9_999).optional()),
  active: z.coerce.boolean(),
});

export async function saveChargeCodeAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("silverfang:configure");
  try {
    const input = chargeCodeSchema.parse({
      id: formValue(formData, "id"),
      code: formValue(formData, "code"),
      name: formValue(formData, "name"),
      kind: formValue(formData, "kind"),
      billableDefault: formData.get("billableDefault") === "on",
      defaultMultiplier: formValue(formData, "defaultMultiplier"),
      sortOrder: formValue(formData, "sortOrder"),
      active: formData.get("active") === "on",
    });

    const clash = await prisma.sfChargeCode.findFirst({
      where: { code: input.code, ...(input.id ? { id: { not: input.id } } : {}) },
      select: { id: true },
    });
    if (clash) return { ok: false, message: `${input.code} is already in use.` };

    const data = {
      code: input.code,
      name: input.name,
      kind: input.kind,
      billableDefault: input.billableDefault,
      defaultMultiplier: input.defaultMultiplier ?? null,
      sortOrder: input.sortOrder ?? 0,
      active: input.active,
    };
    const saved = input.id
      ? await prisma.sfChargeCode.update({ where: { id: input.id }, data })
      : await prisma.sfChargeCode.create({ data });

    await audit({
      action: "SILVERFANG_CONFIG_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: `silverfang:chargeCode:${saved.id}`,
      metadata: { code: saved.code, active: saved.active },
    });
    revalidatePath("/silverfang/setup");
    return { ok: true, message: `Charge code ${saved.code} saved.` };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

// --- Rate rules ------------------------------------------------------------

const rateRuleSchema = z.object({
  id: optionalId,
  scope: z.enum(SfRateScope),
  clientId: optionalId,
  agreementId: optionalId,
  chargeCodeId: optionalId,
  timeBand: z.enum(SfTimeBand),
  fixedRate: optionalMoney,
  multiplier: z.preprocess(emptyToUndefined, z.coerce.number().min(0).max(10).optional()),
  costRate: optionalMoney,
  active: z.coerce.boolean(),
});

/**
 * Save a rate rule. The scope decides which of client/agreement/charge code are
 * required — a CLIENT_SERVICE rule without both is unresolvable, so it is refused
 * rather than stored as a rule that can never match.
 */
export async function saveRateRuleAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("silverfang:configure");
  try {
    const input = rateRuleSchema.parse({
      id: formValue(formData, "id"),
      scope: formValue(formData, "scope"),
      clientId: formValue(formData, "clientId"),
      agreementId: formValue(formData, "agreementId"),
      chargeCodeId: formValue(formData, "chargeCodeId"),
      timeBand: formValue(formData, "timeBand"),
      fixedRate: formValue(formData, "fixedRate"),
      multiplier: formValue(formData, "multiplier"),
      costRate: formValue(formData, "costRate"),
      active: formData.get("active") === "on",
    });

    type ScopeKey = "clientId" | "agreementId" | "chargeCodeId";
    const NEEDS: Record<SfRateScope, ScopeKey[]> = {
      AGREEMENT_SERVICE: ["agreementId", "chargeCodeId"],
      AGREEMENT: ["agreementId"],
      CLIENT_SERVICE: ["clientId", "chargeCodeId"],
      CLIENT: ["clientId"],
      SERVICE: ["chargeCodeId"],
      GLOBAL: [],
    };
    const needs = NEEDS[input.scope];
    const missing = needs.filter((k) => !input[k]);
    if (missing.length > 0) {
      return {
        ok: false,
        message: `A ${input.scope} rule needs ${missing.join(" and ")} — without them it could never match anything.`,
      };
    }
    if (input.fixedRate == null && input.multiplier == null && input.costRate == null) {
      return {
        ok: false,
        message:
          "Set a fixed rate, a multiplier, or a cost rate. A rule that sets none of them has no effect.",
      };
    }

    const data = {
      scope: input.scope,
      // Only the fields the scope uses are stored, so a narrowed rule can't carry
      // a stale id that silently changes what it matches.
      clientId: needs.includes("clientId") ? (input.clientId ?? null) : null,
      agreementId: needs.includes("agreementId") ? (input.agreementId ?? null) : null,
      chargeCodeId: needs.includes("chargeCodeId") ? (input.chargeCodeId ?? null) : null,
      timeBand: input.timeBand,
      fixedRate: input.fixedRate ?? null,
      multiplier: input.multiplier ?? null,
      costRate: input.costRate ?? null,
      active: input.active,
    };
    const saved = input.id
      ? await prisma.sfRateRule.update({ where: { id: input.id }, data })
      : await prisma.sfRateRule.create({ data });

    await audit({
      action: "SILVERFANG_CONFIG_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: `silverfang:rateRule:${saved.id}`,
      metadata: { scope: saved.scope, timeBand: saved.timeBand, active: saved.active },
    });
    revalidatePath("/silverfang/setup");
    return { ok: true, message: "Rate rule saved." };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

export async function deleteRateRuleAction(formData: FormData): Promise<void> {
  const user = await requirePermission("silverfang:configure");
  const id = z.string().min(1).parse(formData.get("id"));
  await prisma.sfRateRule.delete({ where: { id } }).catch(() => null);
  await audit({
    action: "SILVERFANG_CONFIG_CHANGED",
    actorId: user.id,
    actorEmail: user.email,
    target: `silverfang:rateRule:${id}`,
    metadata: { deleted: true },
  });
  revalidatePath("/silverfang/setup");
}

// --- SLA -------------------------------------------------------------------

const slaTargetSchema = z.object({
  slaId: z.string().min(1),
  /** Minutes per priority/kind, as "P1_RESPONSE" style keys. */
  values: z.record(z.string(), z.coerce.number().int().min(1).max(1_000_000)),
});

/** Update every target on an SLA in one save. */
export async function saveSlaTargetsAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("silverfang:configure");
  try {
    const slaId = formValue(formData, "slaId");
    const values: Record<string, number> = {};
    for (const [key, raw] of formData.entries()) {
      if (!key.startsWith("target_") || typeof raw !== "string" || raw.trim() === "") continue;
      values[key.slice("target_".length)] = Number(raw);
    }
    const input = slaTargetSchema.parse({ slaId, values });

    const sla = await prisma.sfSla.findUnique({
      where: { id: input.slaId },
      include: { targets: true },
    });
    if (!sla) return { ok: false, message: "That SLA no longer exists." };

    let updated = 0;
    for (const [key, minutes] of Object.entries(input.values)) {
      const [priority, kind] = key.split("_");
      if (!priority || !kind) continue;
      const existing = sla.targets.find((t) => t.priority === priority && t.kind === kind);
      if (existing) {
        if (existing.minutes !== minutes) {
          await prisma.sfSlaTarget.update({ where: { id: existing.id }, data: { minutes } });
          updated += 1;
        }
      } else {
        await prisma.sfSlaTarget.create({
          data: {
            slaId: input.slaId,
            priority: priority as "P1" | "P2" | "P3" | "P4",
            kind: kind as "RESPONSE" | "RESOLUTION",
            minutes,
          },
        });
        updated += 1;
      }
    }

    await audit({
      action: "SILVERFANG_CONFIG_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: `silverfang:sla:${input.slaId}`,
      metadata: { targetsChanged: updated },
    });
    revalidatePath("/silverfang/setup");
    return {
      ok: true,
      message:
        updated === 0
          ? "No changes to save."
          : `${updated} target(s) updated. Existing tickets keep the due dates they were given.`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

const businessHoursSchema = z.object({
  slaId: z.string().min(1),
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).min(1, "Pick at least one day"),
  startMinute: z.coerce.number().int().min(0).max(1_439),
  endMinute: z.coerce.number().int().min(1).max(1_440),
  timezone: z.string().trim().min(1).max(80),
});

/** Replace an SLA's business-hours windows. */
export async function saveBusinessHoursAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("silverfang:configure");
  try {
    const weekdays = formData
      .getAll("weekdays")
      .filter((v): v is string => typeof v === "string")
      .map(Number);
    const input = businessHoursSchema.parse({
      slaId: formValue(formData, "slaId"),
      weekdays,
      startMinute: formValue(formData, "startMinute"),
      endMinute: formValue(formData, "endMinute"),
      timezone: formValue(formData, "timezone"),
    });
    if (input.endMinute <= input.startMinute) {
      return { ok: false, message: "The end of the working day must be after the start." };
    }
    // Reject an unknown zone here rather than letting every SLA calculation
    // silently fall back to UTC later.
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: input.timezone });
    } catch {
      return { ok: false, message: `"${input.timezone}" is not a recognised timezone.` };
    }

    await prisma.$transaction([
      prisma.sfBusinessHours.deleteMany({ where: { slaId: input.slaId } }),
      prisma.sfBusinessHours.createMany({
        data: input.weekdays.map((weekday) => ({
          slaId: input.slaId,
          weekday,
          startMinute: input.startMinute,
          endMinute: input.endMinute,
          timezone: input.timezone,
        })),
      }),
    ]);

    await audit({
      action: "SILVERFANG_CONFIG_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: `silverfang:sla:${input.slaId}`,
      metadata: { businessHours: input.weekdays.length, timezone: input.timezone },
    });
    revalidatePath("/silverfang/setup");
    return { ok: true, message: "Business hours saved." };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

const holidaySchema = z.object({
  slaId: z.string().min(1),
  date: z.coerce.date({ message: "Pick a date" }),
  name: z.string().trim().min(1, "Name the holiday").max(120),
});

/** Add a holiday, which stops the SLA clock for that whole day. */
export async function addHolidayAction(
  _prev: SfActionResult | null,
  formData: FormData,
): Promise<SfActionResult> {
  const user = await requirePermission("silverfang:configure");
  try {
    const input = holidaySchema.parse({
      slaId: formValue(formData, "slaId"),
      date: formValue(formData, "date"),
      name: formValue(formData, "name"),
    });
    // Stored as UTC midnight: a holiday is a calendar date, not an instant, and
    // storing a local time would shift it for some viewers.
    const date = new Date(
      Date.UTC(input.date.getUTCFullYear(), input.date.getUTCMonth(), input.date.getUTCDate()),
    );

    await prisma.sfHoliday.upsert({
      where: { slaId_date: { slaId: input.slaId, date } },
      create: { slaId: input.slaId, date, name: input.name },
      update: { name: input.name },
    });
    await audit({
      action: "SILVERFANG_CONFIG_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: `silverfang:sla:${input.slaId}`,
      metadata: { holiday: input.name, date: date.toISOString().slice(0, 10) },
    });
    revalidatePath("/silverfang/setup");
    return { ok: true, message: `${input.name} added.` };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

export async function deleteHolidayAction(formData: FormData): Promise<void> {
  await requirePermission("silverfang:configure");
  const id = z.string().min(1).parse(formData.get("id"));
  await prisma.sfHoliday.delete({ where: { id } }).catch(() => null);
  revalidatePath("/silverfang/setup");
}
