import "server-only";
import { prisma } from "@/lib/db";

/**
 * Whether SuperOps is still a source of data for this install.
 *
 * The migration has an end: SuperOps is switched off, the subscription is
 * cancelled, and SilverFang becomes the source of truth. From that moment every
 * path that reads SuperOps has to stop — the scheduled sync, the manual syncs, and
 * every import button — because a connector still running against a dead API
 * produces failures nobody needs to read, and an import button that can only ever
 * import stale data is a trap.
 *
 * One switch for the whole install, not one per connector. A half-on state is
 * exactly what produces contradictions nobody can explain.
 *
 * Switching it off deletes nothing. The tickets, time entries, contacts and notes
 * already imported stay — they are SilverFang's own records now, which is the
 * entire point of having migrated them.
 */

export const MIGRATION_POLICY_ID = "singleton";

export interface MigrationPolicy {
  superOpsEnabled: boolean;
  cutoverAt: Date | null;
  notes: string | null;
  updatedByEmail: string | null;
}

const DEFAULT_POLICY: MigrationPolicy = {
  // Enabled by default: an install that has not made the decision is still
  // mid-migration, and defaulting to off would silently break its sync.
  superOpsEnabled: true,
  cutoverAt: null,
  notes: null,
  updatedByEmail: null,
};

/** The current policy. Absent row means the default, not an error. */
export async function migrationPolicy(): Promise<MigrationPolicy> {
  const row = await prisma.sfMigrationPolicy.findUnique({
    where: { id: MIGRATION_POLICY_ID },
    select: {
      superOpsEnabled: true,
      cutoverAt: true,
      notes: true,
      updatedByEmail: true,
    },
  });
  return row ?? DEFAULT_POLICY;
}

/**
 * The one question every SuperOps code path asks.
 *
 * Deliberately fails **open** on a database error: a transient read failure must
 * not silently stop a sync that is meant to be running, because a sync that
 * quietly does nothing is far harder to notice than one that errors.
 */
export async function superOpsEnabled(): Promise<boolean> {
  try {
    return (await migrationPolicy()).superOpsEnabled;
  } catch {
    return true;
  }
}

/** Set the switch. Records who and when, because this is a one-way door in practice. */
export async function setSuperOpsEnabled(
  input: { enabled: boolean; notes?: string | null },
  actor: { email: string },
): Promise<MigrationPolicy> {
  const data = {
    superOpsEnabled: input.enabled,
    // Stamped when switching off, cleared when switching back on, so the banner
    // never shows a cutover date for a live connector.
    cutoverAt: input.enabled ? null : new Date(),
    notes: input.notes ?? null,
    updatedByEmail: actor.email,
  };
  const row = await prisma.sfMigrationPolicy.upsert({
    where: { id: MIGRATION_POLICY_ID },
    create: { id: MIGRATION_POLICY_ID, ...data },
    update: data,
  });
  return {
    superOpsEnabled: row.superOpsEnabled,
    cutoverAt: row.cutoverAt,
    notes: row.notes,
    updatedByEmail: row.updatedByEmail,
  };
}

/** The message every disabled SuperOps path returns, so they all read the same. */
export const SUPEROPS_OFF_MESSAGE =
  "SuperOps has been switched off for this install — SilverFang is the source of truth. " +
  "Nothing is imported or synced from SuperOps any more. Re-enable it in SilverFang Setup " +
  "if you need to run one more pass.";

/**
 * How much of SuperOps has been brought across, for the cutover page.
 *
 * The point of showing it is that "am I safe to cancel the subscription?" is a
 * question about coverage, not about whether the buttons have been pressed.
 */
export interface MigrationCoverage {
  superOpsTickets: number;
  importedTickets: number;
  superOpsWorklogs: number;
  importedTimeEntries: number;
  superOpsNotes: number;
  importedNotes: number;
  superOpsContacts: number;
  importedContacts: number;
  /** SuperOps clients with no linked Wolf365 client — nothing of theirs can import. */
  unlinkedClients: number;
}

export async function migrationCoverage(): Promise<MigrationCoverage> {
  const source = "SUPEROPS";
  const [
    superOpsTickets,
    importedTickets,
    superOpsWorklogs,
    importedTimeEntries,
    superOpsNotes,
    importedNotes,
    superOpsContacts,
    importedContacts,
    unlinkedClients,
  ] = await Promise.all([
    prisma.superOpsTicket.count(),
    prisma.sfTicket.count({ where: { sourceSystem: source } }),
    prisma.superOpsWorklog.count(),
    prisma.sfTimeEntry.count({ where: { sourceSystem: source } }),
    prisma.superOpsTicketNote.count(),
    prisma.sfTicketNote.count({ where: { sourceSystem: source } }),
    prisma.superOpsContact.count(),
    prisma.sfContact.count({ where: { sourceSystem: source } }),
    prisma.superOpsClient.count({ where: { clientId: null } }),
  ]);

  return {
    superOpsTickets,
    importedTickets,
    superOpsWorklogs,
    importedTimeEntries,
    superOpsNotes,
    importedNotes,
    superOpsContacts,
    importedContacts,
    unlinkedClients,
  };
}

/**
 * Whether everything countable has been brought across.
 *
 * Deliberately not phrased as "safe to cancel": this counts what Wolf365 has
 * mirrored against what it has imported, and it cannot know whether the mirror
 * itself is complete. The page says so.
 */
export function coverageComplete(c: MigrationCoverage): boolean {
  return (
    c.unlinkedClients === 0 &&
    c.importedTickets >= c.superOpsTickets &&
    c.importedTimeEntries >= c.superOpsWorklogs &&
    c.importedNotes >= c.superOpsNotes &&
    c.importedContacts >= c.superOpsContacts
  );
}
