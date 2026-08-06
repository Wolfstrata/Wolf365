/**
 * Calendar-grid arithmetic for the timesheet week view.
 *
 * Pure so the geometry can be tested: a block placed at the wrong offset or with
 * the wrong height silently misrepresents when work happened, which is worse than
 * a visibly broken layout. Times are minutes-from-midnight in the *viewer's* local
 * day — the grid is a day of wall-clock, not an instant timeline.
 */

export interface GridConfig {
  /** First hour shown, 0–23. */
  startHour: number;
  /** Last hour shown (exclusive), 1–24. */
  endHour: number;
  /** Minutes per clickable slot. */
  slotMinutes: number;
}

export const DEFAULT_GRID: GridConfig = { startHour: 7, endHour: 20, slotMinutes: 30 };

/** "09:30" → 570. Returns null for anything unusable. */
export function timeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23) return null;
  return hours * 60 + minutes;
}

/** 570 → "09:30". Clamps into a single day. */
export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "09:30" → "9:30 AM", for labels. */
export function formatClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** The clickable slots of one day column. */
export function daySlots(config: GridConfig = DEFAULT_GRID): number[] {
  const slots: number[] = [];
  for (
    let m = config.startHour * 60;
    m < config.endHour * 60;
    m += config.slotMinutes
  ) {
    slots.push(m);
  }
  return slots;
}

/** Hour marks for the gutter. */
export function hourMarks(config: GridConfig = DEFAULT_GRID): number[] {
  const marks: number[] = [];
  for (let h = config.startHour; h < config.endHour; h += 1) marks.push(h * 60);
  return marks;
}

export interface PlacedBlock {
  /** Percentage from the top of the day column. */
  topPercent: number;
  /** Percentage of the column's height. */
  heightPercent: number;
  /** True when the block extends beyond the visible window. */
  clipped: boolean;
}

/**
 * Position a block within the day column. Blocks partly outside the visible hours
 * are clamped and flagged rather than dropped — hiding a 6am entry because the
 * grid starts at 7 would make logged time invisible.
 */
export function placeBlock(
  startMinutes: number,
  endMinutes: number,
  config: GridConfig = DEFAULT_GRID,
): PlacedBlock {
  const windowStart = config.startHour * 60;
  const windowEnd = config.endHour * 60;
  const span = windowEnd - windowStart;
  const rawStart = Math.min(startMinutes, endMinutes);
  const rawEnd = Math.max(startMinutes, endMinutes);

  const clippedStart = Math.max(windowStart, rawStart);
  const clippedEnd = Math.min(windowEnd, rawEnd);
  const clipped = rawStart < windowStart || rawEnd > windowEnd;

  // A zero-or-negative-length block still needs to be visible and clickable.
  const height = Math.max(clippedEnd - clippedStart, config.slotMinutes / 2);
  return {
    topPercent: ((clippedStart - windowStart) / span) * 100,
    heightPercent: Math.min((height / span) * 100, 100),
    clipped,
  };
}

export interface LaneItem {
  id: string;
  startMinutes: number;
  endMinutes: number;
}

export interface LaneAssignment {
  id: string;
  /** Zero-based column within the day. */
  lane: number;
  /** How many lanes the day needs, so widths can be computed. */
  laneCount: number;
}

/**
 * Assign side-by-side lanes to overlapping blocks, the way a calendar does.
 * Without this, two entries at the same time sit on top of each other and one
 * becomes unclickable.
 */
export function assignLanes(items: LaneItem[]): LaneAssignment[] {
  const sorted = [...items].sort(
    (a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes,
  );
  // Group into clusters of transitively-overlapping blocks; lane count applies
  // per cluster so one busy hour doesn't shrink the whole day.
  const clusters: LaneItem[][] = [];
  let current: LaneItem[] = [];
  let clusterEnd = -1;
  for (const item of sorted) {
    if (current.length > 0 && item.startMinutes >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -1;
    }
    current.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMinutes);
  }
  if (current.length > 0) clusters.push(current);

  const out: LaneAssignment[] = [];
  for (const cluster of clusters) {
    const laneEnds: number[] = [];
    const assigned: { id: string; lane: number }[] = [];
    for (const item of cluster) {
      let lane = laneEnds.findIndex((end) => item.startMinutes >= end);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.endMinutes);
      } else {
        laneEnds[lane] = item.endMinutes;
      }
      assigned.push({ id: item.id, lane });
    }
    for (const a of assigned) out.push({ ...a, laneCount: laneEnds.length });
  }
  return out;
}

/** Decimal hours between two minute marks, never negative. */
export function hoursBetweenMinutes(startMinutes: number, endMinutes: number): number {
  const diff = endMinutes - startMinutes;
  return diff > 0 ? Math.round((diff / 60) * 10_000) / 10_000 : 0;
}

/**
 * Combine a UTC-midnight work date with a local wall-clock minute into an
 * instant. The date carries the day, the minutes carry the time — keeping them
 * separate is what stops a block sliding a day when the viewer's offset changes.
 */
export function instantFor(workDate: Date, minutes: number, offsetMinutes: number): Date {
  return new Date(workDate.getTime() + (minutes + offsetMinutes) * 60_000);
}

/** Local wall-clock minutes of an instant, given the viewer's offset. */
export function minutesOf(instant: Date, offsetMinutes: number): number {
  const shifted = new Date(instant.getTime() - offsetMinutes * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}
