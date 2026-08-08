/**
 * Project template parsing and capture.
 *
 * A template is a list of work, often 20–30 rows, so it is entered as one line
 * per row — `Name | hours` for phases, `Phase | Summary | priority | hours` for
 * tickets — rather than a per-row form nobody wants to fill in. Pure and tested:
 * a silently mis-parsed template would stamp out the wrong shape on every project
 * made from it.
 *
 * The ticket IS the unit of work. There is no separate task: one thing to create,
 * one place to look, one set of hours.
 *
 * The other half of this module goes the other way: `projectToTemplateDraft`
 * turns a real project into a template, dropping everything that made it a
 * specific piece of work (client, agreement, manager, dates, actual hours) and
 * keeping only the shape.
 */

export interface ParsedTemplatePhase {
  name: string;
  hours: number | null;
}

export interface ParsePhaseResult {
  phases: ParsedTemplatePhase[];
  errors: string[];
}

/**
 * Phases, one per line: `Name | hours`.
 *
 * Duplicate names are refused rather than deduped. Phase name is what tickets are
 * attached by, so two phases called "Build" would make attachment ambiguous and
 * silently put half the work in the wrong place.
 */
export function parseTemplatePhases(raw: string | null | undefined): ParsePhaseResult {
  const phases: ParsedTemplatePhase[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  (raw ?? "").split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const lineNo = index + 1;
    const parts = trimmed.split("|").map((p) => p.trim());
    const name = parts[0]!;
    if (!name) {
      errors.push(`Line ${lineNo} has no phase name.`);
      return;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      errors.push(`Line ${lineNo}: there is already a phase called "${name}".`);
      return;
    }

    let hours: number | null = null;
    if (parts[1]) {
      const n = Number(parts[1]);
      if (!Number.isFinite(n) || n < 0) {
        errors.push(`Line ${lineNo}: "${parts[1]}" is not a valid number of hours.`);
        return;
      }
      hours = n;
    }

    seen.add(key);
    phases.push({ name, hours });
  });

  return { phases, errors };
}

/** Render phases back to the textarea form. */
export function formatTemplatePhases(
  phases: { name: string; hours?: number | null }[],
): string {
  return phases
    .map((p) => (p.hours != null ? `${p.name} | ${p.hours}` : p.name))
    .join("\n");
}

export const TEMPLATE_PRIORITIES = ["P1", "P2", "P3", "P4"] as const;
export type TemplatePriority = (typeof TEMPLATE_PRIORITIES)[number];

export interface ParsedTemplateTicket {
  phase: string | null;
  summary: string;
  priority: TemplatePriority;
  estimatedHours: number | null;
}

export interface ParseTicketResult {
  tickets: ParsedTemplateTicket[];
  errors: string[];
}

/**
 * Tickets, one per line: `Phase | Summary | priority | hours`.
 *
 * One column is a bare summary; two or more means the first is the phase, so
 * "Build | Rack the switch" reads the way it looks. Priority defaults to P3 rather
 * than erroring on a blank, because most template tickets are ordinary work.
 */
export function parseTemplateTickets(raw: string | null | undefined): ParseTicketResult {
  const tickets: ParsedTemplateTicket[] = [];
  const errors: string[] = [];

  (raw ?? "").split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const lineNo = index + 1;
    const parts = trimmed.split("|").map((p) => p.trim());
    const hasPhase = parts.length >= 2 && Boolean(parts[1]);
    const summary = hasPhase ? parts[1]! : parts[0]!;
    if (!summary) {
      errors.push(`Line ${lineNo} has no ticket summary.`);
      return;
    }

    const priorityRaw = hasPhase ? parts[2] : parts[1];
    let priority: TemplatePriority = "P3";
    if (priorityRaw) {
      const upper = priorityRaw.toUpperCase();
      if (!TEMPLATE_PRIORITIES.includes(upper as TemplatePriority)) {
        errors.push(
          `Line ${lineNo}: "${priorityRaw}" is not a priority (${TEMPLATE_PRIORITIES.join(", ")}).`,
        );
        return;
      }
      priority = upper as TemplatePriority;
    }

    const hoursRaw = hasPhase ? parts[3] : parts[2];
    let estimatedHours: number | null = null;
    if (hoursRaw) {
      const n = Number(hoursRaw);
      if (!Number.isFinite(n) || n < 0) {
        errors.push(`Line ${lineNo}: "${hoursRaw}" is not a valid number of hours.`);
        return;
      }
      estimatedHours = n;
    }

    tickets.push({
      phase: hasPhase ? (parts[0] || null) : null,
      summary,
      priority,
      estimatedHours,
    });
  });

  return { tickets, errors };
}

/** Render tickets back to the textarea form. */
export function formatTemplateTickets(
  tickets: {
    phase?: string | null;
    summary: string;
    priority?: string | null;
    estimatedHours?: number | null;
  }[],
): string {
  return tickets
    .map((t) => {
      const hours = t.estimatedHours != null ? String(t.estimatedHours) : "";
      // The priority column is positional and always written, because a line with
      // hours but no priority would re-parse the hours as the priority.
      const columns = [t.phase ?? "", t.summary, t.priority ?? "P3", hours];
      return columns.join(" | ").replace(/(\s*\|\s*)+$/, "");
    })
    .join("\n");
}

/**
 * Names referenced by tickets that no phase provides.
 *
 * Reported rather than auto-created: a typo'd phase name should be fixed, not
 * quietly turned into a real phase that then shows up on every generated project.
 */
export function unknownPhaseNames(
  phases: { name: string }[],
  referenced: { phase?: string | null }[],
): string[] {
  const known = new Set(phases.map((p) => p.name.toLowerCase()));
  const missing = new Set<string>();
  for (const row of referenced) {
    const name = row.phase?.trim();
    if (name && !known.has(name.toLowerCase())) missing.add(name);
  }
  return [...missing];
}

export interface TemplateDraft {
  phases: ParsedTemplatePhase[];
  tickets: ParsedTemplateTicket[];
  shape: {
    billingType: string;
    contractedHours: number | null;
    estimatedHours: number | null;
    fixedFeeAmount: number | null;
    billingIntervalDays: number | null;
    depositPercent: number | null;
  };
}

/**
 * Turn a real project into a template draft.
 *
 * What is deliberately dropped: client, agreement, manager, dates, status, actual
 * hours, and the deposit's invoiced state. Those are what make a project a
 * specific piece of work; a template that carried them would generate projects
 * pre-filled with the last client's details.
 *
 * Only the shape survives: phases with their hours, and the open tickets as
 * stubs.
 */
export function projectToTemplateDraft(project: {
  startDate?: Date | null;
  billingType: string;
  contractedHours?: number | null;
  estimatedHours?: number | null;
  fixedFeeAmount?: number | null;
  billingIntervalDays?: number | null;
  depositPercent?: number | null;
  phases: { name: string; hours?: number | null; sortOrder?: number }[];
  tickets?: {
    summary: string;
    phaseName?: string | null;
    priority?: string | null;
    estimatedHours?: number | null;
  }[];
}): TemplateDraft {
  const phases = [...project.phases]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((p) => ({ name: p.name, hours: p.hours ?? null }));

  const tickets = (project.tickets ?? []).map((t) => ({
    phase: t.phaseName ?? null,
    summary: t.summary,
    priority: normalizePriority(t.priority),
    estimatedHours: t.estimatedHours ?? null,
  }));

  return {
    phases,
    tickets,
    shape: {
      billingType: project.billingType,
      contractedHours: project.contractedHours ?? null,
      estimatedHours: project.estimatedHours ?? null,
      fixedFeeAmount: project.fixedFeeAmount ?? null,
      billingIntervalDays: project.billingIntervalDays ?? null,
      depositPercent: project.depositPercent ?? null,
    },
  };
}

function normalizePriority(value: string | null | undefined): TemplatePriority {
  const upper = (value ?? "").toUpperCase();
  return TEMPLATE_PRIORITIES.includes(upper as TemplatePriority)
    ? (upper as TemplatePriority)
    : "P3";
}


