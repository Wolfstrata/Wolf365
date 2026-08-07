import "server-only";
import { prisma } from "@/lib/db";
import { safeErrorMessage } from "@/lib/redact";
import { getGraphToken, graphDelete, graphPatch, graphPost } from "@/lib/crm/graph";
import {
  calendarEventFor,
  eventNeedsUpdate,
  shouldSyncBlock,
  SKIP_LABELS,
  type SkipReason,
  type SyncableBlock,
} from "@/lib/silverfang/calendar-sync";

/**
 * Pushing SilverFang time blocks onto technicians' Outlook calendars.
 *
 * One-way: Wolf365 is the record. An event edited in Outlook is overwritten on the
 * next sync, which the event body says out loud.
 *
 * Nothing here ever throws at its caller. A calendar that will not update is
 * annoying; a calendar that will not update AND rolls back the time entry a tech
 * just logged is a data-loss bug wearing an integration's clothes. Every failure
 * is recorded on the link row and reported, and the block is saved regardless.
 *
 * DEPLOYMENT PREREQUISITE, and the most likely reason this returns 403: the Entra
 * app needs the application permission `Calendars.ReadWrite`, and the RBAC
 * application scope that limits which mailboxes it can touch must include the
 * technicians' own mailboxes. The existing scope covers the SilverFang shared
 * mailboxes only, so tech calendars have to be added to it deliberately — this is
 * not something the app can grant itself.
 */

export type CalendarOutcome =
  | { ok: true; action: "created" | "updated" | "unchanged" | "deleted" }
  | { ok: true; action: "skipped"; reason: SkipReason; detail: string }
  | { ok: false; detail: string };

interface GraphEvent {
  id: string;
  iCalUId?: string;
}

/** Load one block in the shape the pure logic needs, plus its owner's settings. */
async function loadBlock(timeEntryId: string) {
  const entry = await prisma.sfTimeEntry.findUnique({
    where: { id: timeEntryId },
    select: {
      id: true,
      userId: true,
      startedAt: true,
      endedAt: true,
      notes: true,
      internalOnly: true,
      chargeCode: { select: { name: true } },
      ticketId: true,
      ticket: {
        select: { number: true, summary: true, client: { select: { name: true } } },
      },
      calendarLink: true,
    },
  });
  if (!entry) return null;

  const profile = await prisma.sfTechProfile.findUnique({
    where: { userId: entry.userId },
    select: { calendarMailbox: true, calendarSyncEnabled: true, active: true },
  });

  const block: SyncableBlock = {
    id: entry.id,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    notes: entry.notes,
    internalOnly: entry.internalOnly,
    ticketNumber: entry.ticket?.number ?? null,
    ticketSummary: entry.ticket?.summary ?? null,
    clientName: entry.ticket?.client.name ?? null,
    chargeCodeName: entry.chargeCode?.name ?? null,
  };

  return { entry, block, profile, link: entry.calendarLink };
}

/**
 * Create, update or remove the calendar event for one time block.
 *
 * Called after a block is saved. Idempotent: a block whose window has not moved
 * reports `unchanged` and sends nothing, so re-running is free.
 */
export async function syncTimeBlock(timeEntryId: string): Promise<CalendarOutcome> {
  try {
    const loaded = await loadBlock(timeEntryId);
    if (!loaded) return { ok: false, detail: "That time block no longer exists." };
    const { block, profile, link } = loaded;

    const decision = shouldSyncBlock(block, {
      calendarMailbox: profile?.calendarMailbox ?? null,
      calendarSyncEnabled: profile?.calendarSyncEnabled ?? false,
      active: profile?.active ?? false,
    });

    if (!decision.sync) {
      // A block that used to qualify and no longer does (its times were cleared,
      // or sync was switched off) leaves an event behind that is now a lie. Remove
      // it rather than letting the calendar keep asserting something untrue.
      if (link) {
        await removeEventFor(link.id, link.mailbox, link.eventId);
      }
      return {
        ok: true,
        action: "skipped",
        reason: decision.reason,
        detail: SKIP_LABELS[decision.reason],
      };
    }

    const mailbox = profile!.calendarMailbox!.trim();
    const shape = calendarEventFor(block);
    const token = await getGraphToken();
    if (!token) {
      return { ok: false, detail: "Microsoft Graph is not configured, so no event was written." };
    }

    // The mailbox can change on the profile. An event in the old mailbox would sit
    // there forever, so it is removed before the new one is created.
    if (link && link.mailbox !== mailbox) {
      await removeEventFor(link.id, link.mailbox, link.eventId);
    } else if (link) {
      if (!eventNeedsUpdate(link, block)) return { ok: true, action: "unchanged" };
      const patched = await graphPatch<GraphEvent>(
        token,
        `/users/${encodeURIComponent(mailbox)}/events/${encodeURIComponent(link.eventId)}`,
        graphBody(shape),
      );
      if (!patched.ok) {
        // 404 means the tech deleted it in Outlook. Drop the link and fall through
        // to creating a fresh one, rather than retrying a PATCH forever.
        if (patched.status === 404) {
          await prisma.sfCalendarLink.delete({ where: { id: link.id } }).catch(() => {});
        } else {
          await recordError(link.id, patched.error ?? `HTTP ${patched.status}`);
          return { ok: false, detail: describeGraphFailure(patched.status, patched.error) };
        }
      } else {
        await prisma.sfCalendarLink.update({
          where: { id: link.id },
          data: {
            startAt: block.startedAt!,
            endAt: block.endedAt!,
            syncedAt: new Date(),
            lastError: null,
          },
        });
        return { ok: true, action: "updated" };
      }
    }

    const created = await graphPost<GraphEvent>(
      token,
      `/users/${encodeURIComponent(mailbox)}/events`,
      graphBody(shape),
    );
    if (!created.ok || !created.data?.id) {
      return { ok: false, detail: describeGraphFailure(created.status, created.error) };
    }

    await prisma.sfCalendarLink.upsert({
      where: { timeEntryId },
      create: {
        timeEntryId,
        // Also linked to the ticket, so a ticket can show its scheduled blocks.
        ticketId: loaded.entry.ticketId,
        mailbox,
        eventId: created.data.id,
        iCalUid: created.data.iCalUId ?? null,
        startAt: block.startedAt!,
        endAt: block.endedAt!,
      },
      update: {
        ticketId: loaded.entry.ticketId,
        mailbox,
        eventId: created.data.id,
        iCalUid: created.data.iCalUId ?? null,
        startAt: block.startedAt!,
        endAt: block.endedAt!,
        syncedAt: new Date(),
        lastError: null,
      },
    });
    return { ok: true, action: "created" };
  } catch (err) {
    // Deliberately swallowed: see the module comment. Saving the block matters
    // more than putting it on a calendar.
    return { ok: false, detail: safeErrorMessage(err) };
  }
}

/**
 * Remove the event for a block that is about to be deleted.
 *
 * Called BEFORE the block is deleted, because the link row cascades with it and
 * takes the Graph event id with it — after the delete there is nothing left to say
 * which event to remove, and it would sit in the mailbox forever.
 */
export async function removeTimeBlockEvent(timeEntryId: string): Promise<CalendarOutcome> {
  try {
    const link = await prisma.sfCalendarLink.findUnique({ where: { timeEntryId } });
    if (!link) return { ok: true, action: "unchanged" };
    const result = await removeEventFor(link.id, link.mailbox, link.eventId);
    return result;
  } catch (err) {
    return { ok: false, detail: safeErrorMessage(err) };
  }
}

/** Delete the Graph event and the link row. A 404 counts as gone. */
async function removeEventFor(
  linkId: string,
  mailbox: string,
  eventId: string,
): Promise<CalendarOutcome> {
  const token = await getGraphToken();
  if (!token) {
    return { ok: false, detail: "Microsoft Graph is not configured, so the event was left in place." };
  }
  const deleted = await graphDelete(
    token,
    `/users/${encodeURIComponent(mailbox)}/events/${encodeURIComponent(eventId)}`,
  );
  if (!deleted.ok) {
    await recordError(linkId, deleted.error ?? `HTTP ${deleted.status}`);
    return { ok: false, detail: describeGraphFailure(deleted.status, deleted.error) };
  }
  // The row goes only once the event is actually gone, so a failed delete stays
  // visible and retryable instead of being forgotten.
  await prisma.sfCalendarLink.delete({ where: { id: linkId } }).catch(() => {});
  return { ok: true, action: "deleted" };
}

async function recordError(linkId: string, message: string): Promise<void> {
  await prisma.sfCalendarLink
    .update({ where: { id: linkId }, data: { lastError: message } })
    .catch(() => {});
}

/**
 * Graph's event payload. Times are sent as UTC with an explicit timeZone, because
 * Graph interprets a bare dateTime in the mailbox's own zone — which would move
 * every event by the tech's offset.
 */
function graphBody(shape: {
  subject: string;
  body: string;
  startIso: string;
  endIso: string;
}) {
  return {
    subject: shape.subject,
    body: { contentType: "text", content: shape.body },
    start: { dateTime: shape.startIso, timeZone: "UTC" },
    end: { dateTime: shape.endIso, timeZone: "UTC" },
    // Not an invitation: nobody is being asked to attend, and a reminder on
    // someone else's logged work is noise.
    isReminderOn: false,
    categories: ["Wolf365"],
  };
}

/** Turn a Graph failure into something an admin can act on. */
function describeGraphFailure(status: number, error: string | undefined): string {
  if (status === 403) {
    return (
      "Microsoft Graph refused access (403). The app needs the Calendars.ReadWrite " +
      "application permission, and its mailbox access scope must include this " +
      "technician's mailbox — the SilverFang mail scope covers the shared mailboxes only."
    );
  }
  if (status === 404) {
    return "Microsoft Graph could not find that mailbox (404). Check the calendar mailbox address on the technician's profile.";
  }
  return error ? `Microsoft Graph error (${status}): ${error}` : `Microsoft Graph error (${status}).`;
}
