"use client";

import { useId, useState } from "react";
import { helpTopic } from "@/lib/silverfang/help";

/**
 * The silver paw: hover or focus it for a short explanation of the screen.
 *
 * Deliberately a `<button>` rather than a decorated span. A tooltip that only
 * appears on hover is invisible to anyone using a keyboard, and on a touch screen
 * there is no hover at all — a button gets focus, Enter and tap for free, and
 * screen readers announce it.
 *
 * The panel is `role="tooltip"` and linked by aria-describedby, so it is read out
 * rather than being decoration only sighted mouse users can reach.
 *
 * Renders nothing for an unknown topic id. An empty tooltip looks broken and
 * teaches people to stop hovering, which is worse than no paw at all.
 */
export function PawTip({
  topic,
  align = "left",
}: {
  topic: string;
  /** Which edge the panel hangs from — flip it near the right edge of the page. */
  align?: "left" | "right";
}) {
  const help = helpTopic(topic);
  const id = useId();
  const [open, setOpen] = useState(false);

  if (!help) return null;

  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-label={`What is ${help.title}?`}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        // Tap toggles rather than only opening, so a touch user can dismiss it.
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className="group inline-flex h-5 w-5 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/silverfang-paw.png"
          alt=""
          aria-hidden="true"
          className="h-4 w-4 object-contain opacity-70 transition duration-150 group-hover:scale-110 group-hover:opacity-100 group-focus-visible:opacity-100"
          style={{
            // The glow, applied as a filter so it follows the paw's own shape
            // rather than sitting behind a square box.
            filter: open
              ? "drop-shadow(0 0 5px rgba(34,211,238,0.95)) drop-shadow(0 0 12px rgba(34,211,238,0.55))"
              : "none",
          }}
        />
      </button>

      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute top-6 z-50 w-72 rounded-md border bg-popover p-3 text-left shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <span className="block text-xs font-semibold">{help.title}</span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {help.body}
          </span>
          {help.todo && (
            <span className="mt-2 block border-t pt-2 text-xs leading-relaxed">
              <span className="font-medium">What to do: </span>
              {help.todo}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
