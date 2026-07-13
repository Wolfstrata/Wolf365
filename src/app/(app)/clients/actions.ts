"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/redact";
import { ensureArchiveColumn } from "@/lib/licensing/archive";

export interface SubsidiaryActionResult {
  ok: boolean;
  message: string;
}

export interface ClientArchiveResult {
  ok: boolean;
  message: string;
}

/**
 * Archive or restore an entire client. Archiving files the whole client away —
 * it disappears from the M365 clients list, dashboard math, reports, and the
 * billing client picker; restoring returns it everywhere. Individual line
 * (subscription) archiving is separate and untouched by this. Gated by
 * billing:edit and audited.
 */
export async function setClientArchivedAction(
  clientId: string,
  archived: boolean,
): Promise<ClientArchiveResult> {
  const actor = await requirePermission("billing:edit");
  try {
    await ensureArchiveColumn();
    // Guard against a bad id so we never silently no-op yet report success.
    const existing = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true },
    });
    if (!existing) return { ok: false, message: "Client not found." };

    await prisma.client.update({ where: { id: clientId }, data: { archived } });
    await audit({
      action: archived ? "CLIENT_ARCHIVED" : "CLIENT_UNARCHIVED",
      actorId: actor.id,
      actorEmail: actor.email,
      target: `client:${clientId}`,
    });
    revalidatePath("/clients");
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/");
    return { ok: true, message: archived ? "Client archived." : "Client restored." };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/**
 * Set the full subsidiary list for a parent client. Selected clients become
 * subsidiaries of `parentId` (moving off any previous parent automatically,
 * since a client has one parent); clients previously under this parent but no
 * longer selected are detached. Self/ancestor selections are ignored to avoid
 * cycles.
 */
export async function setClientSubsidiariesAction(
  parentId: string,
  childIds: string[],
): Promise<SubsidiaryActionResult> {
  const actor = await requirePermission("mappings:approve");
  try {
    const parent = await prisma.client.findUniqueOrThrow({
      where: { id: parentId },
      select: { id: true, name: true },
    });

    // Walk the parent's ancestor chain so we never make an ancestor (or the
    // parent itself) into a subsidiary — that would create a cycle.
    const ancestors = new Set<string>([parentId]);
    let cursorId: string | null = parentId;
    for (let i = 0; i < 50; i++) {
      if (!cursorId) break;
      const row: { parentClientId: string | null } | null =
        await prisma.client.findUnique({
          where: { id: cursorId },
          select: { parentClientId: true },
        });
      const next: string | null = row?.parentClientId ?? null;
      if (next) ancestors.add(next);
      cursorId = next;
    }

    const wanted = [...new Set(childIds)].filter((id) => !ancestors.has(id));

    const current = await prisma.client.findMany({
      where: { parentClientId: parentId },
      select: { id: true },
    });
    const currentIds = current.map((c) => c.id);
    const toDetach = currentIds.filter((id) => !wanted.includes(id));

    await prisma.$transaction([
      ...wanted.map((id) =>
        prisma.client.update({ where: { id }, data: { parentClientId: parentId } }),
      ),
      ...toDetach.map((id) =>
        prisma.client.update({ where: { id }, data: { parentClientId: null } }),
      ),
    ]);

    await audit({
      action: "MAPPING_CHANGED",
      actorId: actor.id,
      actorEmail: actor.email,
      target: `clientHierarchy:${parentId}`,
      metadata: { parent: parent.name, attached: wanted.length, detached: toDetach.length },
    });

    revalidatePath(`/clients/${parentId}`);
    revalidatePath("/clients");
    return {
      ok: true,
      message: `Saved: ${wanted.length} subsidiary(ies)${
        toDetach.length ? `, ${toDetach.length} removed` : ""
      }.`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}
