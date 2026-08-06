/**
 * Project template task parsing.
 *
 * A template is a checklist, often 20–30 steps, so it is entered as one line per
 * task — `Phase | Name | hours | dayOffset` — rather than a per-row form nobody
 * wants to fill in. Pure and tested: a silently mis-parsed template would stamp
 * out wrong task lists on every project made from it.
 */

export interface ParsedTemplateTask {
  phase: string | null;
  name: string;
  estimatedHours: number | null;
  /** Days after project start this task is due. */
  dueOffsetDays: number | null;
}

export interface ParseResult {
  tasks: ParsedTemplateTask[];
  errors: string[];
}

const MAX_OFFSET_DAYS = 3_650;

export function parseTemplateTasks(raw: string | null | undefined): ParseResult {
  const tasks: ParsedTemplateTask[] = [];
  const errors: string[] = [];
  const lines = (raw ?? "").split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parts = trimmed.split("|").map((p) => p.trim());
    const lineNo = index + 1;

    // One column is a bare task name. Two or more means the first is the phase,
    // so "Discovery | Kickoff call" reads the way it looks.
    const hasPhase = parts.length >= 2 && Boolean(parts[1]);
    const name = hasPhase ? parts[1]! : parts[0]!;
    if (!name) {
      errors.push(`Line ${lineNo} has no task name.`);
      return;
    }

    const hoursRaw = hasPhase ? parts[2] : parts[1];
    const offsetRaw = hasPhase ? parts[3] : parts[2];

    let estimatedHours: number | null = null;
    if (hoursRaw) {
      const n = Number(hoursRaw);
      if (!Number.isFinite(n) || n < 0) {
        errors.push(`Line ${lineNo}: "${hoursRaw}" is not a valid number of hours.`);
        return;
      }
      estimatedHours = n;
    }

    let dueOffsetDays: number | null = null;
    if (offsetRaw) {
      const n = Number(offsetRaw);
      if (!Number.isInteger(n) || n < 0 || n > MAX_OFFSET_DAYS) {
        errors.push(
          `Line ${lineNo}: "${offsetRaw}" is not a valid day offset (whole days, 0–${MAX_OFFSET_DAYS}).`,
        );
        return;
      }
      dueOffsetDays = n;
    }

    tasks.push({ phase: hasPhase ? (parts[0] || null) : null, name, estimatedHours, dueOffsetDays });
  });

  return { tasks, errors };
}

/** Render tasks back to the textarea form, so editing a template round-trips. */
export function formatTemplateTasks(
  tasks: {
    phase?: string | null;
    name: string;
    estimatedHours?: number | null;
    dueOffsetDays?: number | null;
  }[],
): string {
  return tasks
    .map((t) => {
      const hours = t.estimatedHours != null ? String(t.estimatedHours) : "";
      const offset = t.dueOffsetDays != null ? String(t.dueOffsetDays) : "";
      const hasTail = Boolean(hours || offset);
      // The phase column is positional, so when a task has hours but no phase the
      // column must still be there — otherwise re-parsing would read the name as
      // the phase and the hours as the name. When there is no tail either, the
      // line is just a name and needs no separators at all.
      const columns =
        t.phase || hasTail ? [t.phase ?? "", t.name, hours, offset] : [t.name];
      return columns
        .join(" | ")
        .replace(/(\s*\|\s*)+$/, "");
    })
    .join("\n");
}
