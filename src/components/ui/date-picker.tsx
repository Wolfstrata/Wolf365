"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Self-contained calendar date pickers — no external dependency, CSP-safe (no
 * inline scripts). Each renders a text-styled trigger plus a calendar popover
 * and submits its value through a hidden input, so it is a drop-in replacement
 * for `<input type="date">` / `<input type="month">` in a plain <form>.
 *
 * - `DatePicker` value / hidden input: "YYYY-MM-DD".
 * - `MonthPicker` value / hidden input: "YYYY-MM".
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parseDate(s: string | null | undefined): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

function parseMonth(s: string | null | undefined): { y: number; m: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(s ?? "");
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1 };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

function firstWeekday(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 1)).getUTCDay();
}

/** Close the popover on outside click or Escape while it is open. */
function useDismiss<T extends HTMLElement>(
  open: boolean,
  close: () => void,
  ref: RefObject<T | null>,
): void {
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, ref]);
}

const TRIGGER_CLASS =
  "flex w-full items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm transition hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/40";
const POPOVER_CLASS =
  "absolute left-0 top-full z-30 mt-1 w-64 rounded-md border bg-card p-3 shadow-lg";
const NAV_BTN_CLASS =
  "rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground";

export function DatePicker({
  name,
  defaultValue,
  required,
  id,
  placeholder = "Select a date",
}: {
  name: string;
  defaultValue?: string;
  required?: boolean;
  id?: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const now = new Date();
  const parsed = parseDate(value);
  const [viewYear, setViewYear] = useState(parsed?.y ?? now.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.m ?? now.getMonth());
  useDismiss(open, () => setOpen(false), ref);

  function toggle() {
    if (!open) {
      const p = parseDate(value);
      if (p) {
        setViewYear(p.y);
        setViewMonth(p.m);
      }
    }
    setOpen((o) => !o);
  }

  function shiftMonth(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setViewMonth(m);
    setViewYear(y);
  }

  function pick(day: number) {
    setValue(`${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`);
    setOpen(false);
  }

  const label = parsed ? `${MONTHS_SHORT[parsed.m]} ${parsed.d}, ${parsed.y}` : "";
  const lead = firstWeekday(viewYear, viewMonth);
  const total = daysInMonth(viewYear, viewMonth);
  const isToday = (d: number) =>
    d === now.getDate() && viewMonth === now.getMonth() && viewYear === now.getFullYear();
  const isSelected = (d: number) =>
    !!parsed && parsed.d === d && parsed.m === viewMonth && parsed.y === viewYear;

  return (
    <div className="relative" ref={ref}>
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        id={id}
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={TRIGGER_CLASS}
      >
        <span className={cn(!label && "text-muted-foreground")}>{label || placeholder}</span>
        <span className="flex items-center gap-1">
          {value && (
            <X
              className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
              role="button"
              aria-label="Clear date"
              onClick={(e) => {
                e.stopPropagation();
                setValue("");
              }}
            />
          )}
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
        </span>
      </button>
      {/* Keep required semantics for server-side use; hidden inputs are barred
          from constraint validation, so the action still validates presence. */}
      {required && !value && <span className="sr-only">required</span>}

      {open && (
        <div className={POPOVER_CLASS}>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => shiftMonth(-1)} className={NAV_BTN_CLASS} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button type="button" onClick={() => shiftMonth(1)} className={NAV_BTN_CLASS} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium uppercase text-muted-foreground">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-1">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: lead }).map((_, i) => (
              <div key={`b${i}`} />
            ))}
            {Array.from({ length: total }).map((_, i) => {
              const day = i + 1;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => pick(day)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-md text-sm transition hover:bg-accent",
                    isSelected(day) && "bg-primary text-primary-foreground hover:bg-primary",
                    !isSelected(day) && isToday(day) && "border border-primary/50 font-medium",
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function MonthPicker({
  name,
  defaultValue,
  required,
  id,
  placeholder = "Select a month",
}: {
  name: string;
  defaultValue?: string;
  required?: boolean;
  id?: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const now = new Date();
  const parsed = parseMonth(value);
  const [viewYear, setViewYear] = useState(parsed?.y ?? now.getFullYear());
  useDismiss(open, () => setOpen(false), ref);

  function toggle() {
    if (!open) {
      const p = parseMonth(value);
      if (p) setViewYear(p.y);
    }
    setOpen((o) => !o);
  }

  function pick(m: number) {
    setValue(`${viewYear}-${pad(m + 1)}`);
    setOpen(false);
  }

  const label = parsed ? `${MONTHS[parsed.m]} ${parsed.y}` : "";
  const isSelected = (m: number) => !!parsed && parsed.m === m && parsed.y === viewYear;
  const isCurrent = (m: number) => m === now.getMonth() && viewYear === now.getFullYear();

  return (
    <div className="relative" ref={ref}>
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        id={id}
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={TRIGGER_CLASS}
      >
        <span className={cn(!label && "text-muted-foreground")}>{label || placeholder}</span>
        <span className="flex items-center gap-1">
          {value && (
            <X
              className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
              role="button"
              aria-label="Clear month"
              onClick={(e) => {
                e.stopPropagation();
                setValue("");
              }}
            />
          )}
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
        </span>
      </button>
      {required && !value && <span className="sr-only">required</span>}

      {open && (
        <div className={POPOVER_CLASS}>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => setViewYear((y) => y - 1)} className={NAV_BTN_CLASS} aria-label="Previous year">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium">{viewYear}</span>
            <button type="button" onClick={() => setViewYear((y) => y + 1)} className={NAV_BTN_CLASS} aria-label="Next year">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {MONTHS_SHORT.map((m, i) => (
              <button
                key={m}
                type="button"
                onClick={() => pick(i)}
                className={cn(
                  "rounded-md px-2 py-2 text-sm transition hover:bg-accent",
                  isSelected(i) && "bg-primary text-primary-foreground hover:bg-primary",
                  !isSelected(i) && isCurrent(i) && "border border-primary/50 font-medium",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
