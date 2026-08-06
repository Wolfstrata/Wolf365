import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { diffFields, type FieldChange } from "@/lib/silverfang/changes";

/**
 * Writes the SilverFang change trail. The comparison itself is pure (changes.ts);
 * this is only the I/O edge.
 *
 * Never throws: an audit write failing must not roll back the change it was
 * describing, and a swallowed trail row is better than a lost edit. Failures are
 * rare and visible in the platform logs.
 */

export interface RecordChangesInput {
  entity: string;
  entityId: string;
  entityLabel?: string | null;
  actor: { id: string | null; email: string | null };
  /** Row as it was, or null for a creation. */
  before?: Record<string, unknown> | null;
  /** Row as it now is, or null for a deletion. */
  after?: Record<string, unknown> | null;
  /** Fields to compare. Required so bookkeeping columns can't leak in. */
  fields: string[];
  tx?: Prisma.TransactionClient;
}

/**
 * Record what changed. Creation and deletion get a single `*` row so the trail
 * shows the record's whole lifecycle, not just edits in the middle of it.
 */
export async function recordChanges(input: RecordChangesInput): Promise<FieldChange[]> {
  const db = input.tx ?? prisma;
  const base = {
    entity: input.entity,
    entityId: input.entityId,
    entityLabel: input.entityLabel ?? null,
    actorId: input.actor.id,
    actorEmail: input.actor.email,
  };

  try {
    if (!input.after) {
      await db.sfChangeLog.create({ data: { ...base, field: "*", operation: "DELETE" } });
      return [];
    }
    if (!input.before) {
      await db.sfChangeLog.create({ data: { ...base, field: "*", operation: "CREATE" } });
      // A creation records the event, not a diff against nothing — the record's
      // initial state is the record itself.
      return [];
    }

    const changes = diffFields(input.before, input.after, input.fields);
    if (changes.length > 0) {
      await db.sfChangeLog.createMany({
        data: changes.map((c) => ({
          ...base,
          field: c.field,
          oldValue: c.oldValue,
          newValue: c.newValue,
          operation: "UPDATE",
        })),
      });
    }
    return changes;
  } catch {
    // Deliberately swallowed — see the note above.
    return [];
  }
}

export interface ChangeLogRow {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  operation: string;
  actorEmail: string | null;
  createdAt: Date;
}

/** The trail for one record, newest first. */
export async function changeLogFor(
  entity: string,
  entityId: string,
  take = 100,
): Promise<ChangeLogRow[]> {
  return prisma.sfChangeLog.findMany({
    where: { entity, entityId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      field: true,
      oldValue: true,
      newValue: true,
      operation: true,
      actorEmail: true,
      createdAt: true,
    },
  });
}
