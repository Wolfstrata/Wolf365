"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { filterOptions, type FilterableOption } from "@/lib/filter-options";

/**
 * Type-to-filter pickers, for lists too long to scroll.
 *
 * A native `<select>` with two thousand clients in it can only be searched by
 * typing the *first* letters of the name, which is useless when you think of the
 * company as "Penner" and it is filed as "EG Penner Building Centres". These take
 * a query and filter on substrings across every word.
 *
 * Both post their value through a hidden input, so the surrounding form and the
 * server action are unchanged — a combobox here is a drop-in replacement for a
 * select, not a new submission mechanism.
 *
 * Keyboard: ↑/↓ move, Enter picks the highlighted option, Escape closes. The
 * highlight resets to the top on every keystroke, so typing then pressing Enter
 * lands on the best match without ever touching the arrow keys.
 */

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** Shared open/close-on-outside-click behaviour. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, close]);
  return ref;
}

function OptionList({
  options,
  highlighted,
  selectedIds,
  onPick,
  onHover,
  listId,
  emptyMessage,
}: {
  options: FilterableOption[];
  highlighted: number;
  selectedIds: string[];
  onPick: (option: FilterableOption) => void;
  onHover: (index: number) => void;
  listId: string;
  emptyMessage: string;
}) {
  return (
    <ul
      id={listId}
      role="listbox"
      // bg-card, not bg-popover: this theme defines no --popover token, so that
      // class renders a transparent panel over whatever is behind it.
      className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-card p-1 text-card-foreground shadow-xl ring-1 ring-black/10"
    >
      {options.length === 0 ? (
        <li className="px-2 py-2 text-xs text-muted-foreground">{emptyMessage}</li>
      ) : (
        options.map((option, i) => {
          const selected = selectedIds.includes(option.id);
          return (
            <li key={option.id} role="option" aria-selected={selected}>
              <button
                type="button"
                // Mouse down rather than click: a click fires after blur, and the
                // blur closes the list before the pick would land.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(option);
                }}
                onMouseEnter={() => onHover(i)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                  i === highlighted ? "bg-accent text-accent-foreground" : ""
                }`}
              >
                <Check
                  className={`h-3.5 w-3.5 shrink-0 ${selected ? "opacity-100" : "opacity-0"}`}
                />
                <span className="truncate">{option.label}</span>
              </button>
            </li>
          );
        })
      )}
    </ul>
  );
}

/**
 * Pick one option. Submits `name` as the chosen id, or empty when nothing is
 * chosen, so it behaves exactly like the `<select>` it replaces.
 */
export function Combobox({
  name,
  formId,
  options,
  value,
  onChange,
  placeholder = "Type to search…",
  emptyLabel = "Any",
  required,
  disabled,
  className,
}: {
  name: string;
  /**
   * Ties the hidden input to a form elsewhere in the DOM. Needed inside a table,
   * where a `<form>` cannot wrap cells, so the form lives in one cell and the
   * controls point at it.
   */
  formId?: string;
  options: FilterableOption[];
  /** Controlled when provided with `onChange`; otherwise self-managed. */
  value?: string;
  onChange?: (id: string) => void;
  placeholder?: string;
  /** Label for the "nothing selected" row. Omit the row by passing null. */
  emptyLabel?: string | null;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [internal, setInternal] = useState(value ?? "");
  const selectedId = value ?? internal;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const listId = useId();
  const ref = useDismiss(open, () => {
    setOpen(false);
    setQuery("");
  });

  const selected = options.find((o) => o.id === selectedId) ?? null;
  const shown = useMemo(() => filterOptions(options, query), [options, query]);

  function pick(id: string) {
    if (onChange) onChange(id);
    else setInternal(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <input type="hidden" name={name} value={selectedId} {...(formId ? { form: formId } : {})} />
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          // The input shows the chosen label while closed and the query while
          // open, so it reads as a value when at rest and as a search when in use.
          value={open ? query : (selected?.label ?? "")}
          placeholder={selected ? selected.label : placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Back to the best match on every keystroke, so type-then-Enter works.
            setHighlighted(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHighlighted((h) => Math.min(h + 1, Math.max(shown.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlighted((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              if (!open) return;
              // Only swallow Enter when it is actually picking something —
              // otherwise it would stop being a form submit.
              const option = shown[highlighted];
              if (option) {
                e.preventDefault();
                pick(option.id);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
              setQuery("");
            }
          }}
          className={`${INPUT_CLS} pr-14`}
        />
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
          {selected && !required && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick("");
              }}
              aria-label="Clear"
              className="rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronDown className="mr-1 h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {open && (
        <OptionList
          listId={listId}
          options={
            emptyLabel != null && query === ""
              ? [{ id: "", label: emptyLabel }, ...shown]
              : shown
          }
          highlighted={highlighted}
          selectedIds={selectedId ? [selectedId] : [""]}
          onPick={(o) => pick(o.id)}
          onHover={setHighlighted}
          emptyMessage="Nothing matches — try fewer letters."
        />
      )}
    </div>
  );
}

/**
 * Pick several. Submits `name` once per selection, which is how a repeated form
 * field naturally arrives at a server action as a list.
 *
 * Additive by construction: picking someone adds them to the chips above the box
 * and leaves the existing choices alone. Removing is explicit — an × on the chip.
 * That is the difference between "assign also to Sam" and "assign instead to Sam",
 * and getting it wrong silently unassigns whoever was on the ticket.
 */
export function MultiCombobox({
  name,
  formId,
  options,
  value,
  onChange,
  placeholder = "Type to search…",
  disabled,
  className,
  emptySelectionLabel = "Nobody selected",
}: {
  name: string;
  /** See `Combobox` — ties the hidden inputs to a form elsewhere in the DOM. */
  formId?: string;
  options: FilterableOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  emptySelectionLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const listId = useId();
  const ref = useDismiss(open, () => {
    setOpen(false);
    setQuery("");
  });

  const shown = useMemo(() => filterOptions(options, query), [options, query]);
  const chosen = value
    .map((id) => options.find((o) => o.id === id))
    .filter((o): o is FilterableOption => Boolean(o));

  function toggle(id: string) {
    if (!id) return;
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
    // The list stays open: picking three people should be three clicks, not three
    // click-reopen cycles.
    setQuery("");
  }

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      {value.map((id) => (
        <input
          key={id}
          type="hidden"
          name={name}
          value={id}
          {...(formId ? { form: formId } : {})}
        />
      ))}

      {chosen.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {chosen.map((o) => (
            <span
              key={o.id}
              className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground"
            >
              {o.label}
              <button
                type="button"
                onClick={() => toggle(o.id)}
                aria-label={`Remove ${o.label}`}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="mb-1.5 text-xs text-muted-foreground">{emptySelectionLabel}</p>
      )}

      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlighted(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHighlighted((h) => Math.min(h + 1, Math.max(shown.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlighted((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              if (!open) return;
              const option = shown[highlighted];
              if (option) {
                e.preventDefault();
                toggle(option.id);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
              setQuery("");
            } else if (e.key === "Backspace" && query === "" && value.length > 0) {
              // Backspace on an empty box removes the last chip, which is how every
              // other tag input behaves.
              onChange(value.slice(0, -1));
            }
          }}
          className={`${INPUT_CLS} pr-8`}
        />
        <ChevronDown className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>

      {open && (
        <OptionList
          listId={listId}
          options={shown}
          highlighted={highlighted}
          selectedIds={value}
          onPick={(o) => toggle(o.id)}
          onHover={setHighlighted}
          emptyMessage="Nothing matches — try fewer letters."
        />
      )}
    </div>
  );
}
