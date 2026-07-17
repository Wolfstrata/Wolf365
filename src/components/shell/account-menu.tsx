"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { LogOut, Settings as SettingsIcon, ChevronUp } from "lucide-react";

export interface AccountMenuItem {
  label: string;
  href: string;
}

/**
 * Account button in the sidebar footer. Clicking the signed-in user's name opens
 * a popover with the Administration menu (permission-filtered), Settings, and
 * Sign out — these were removed from the main nav and live here now.
 */
export function AccountMenu({
  name,
  roleLabel,
  initials,
  adminItems,
  signOutAction,
}: {
  name: string;
  roleLabel: string;
  initials: string;
  adminItems: AccountMenuItem[];
  signOutAction: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-2 max-h-[70vh] overflow-y-auto rounded-md border bg-card shadow-lg">
          {adminItems.length > 0 && (
            <div className="py-1">
              <p className="px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Administration
              </p>
              {adminItems.map((i) => (
                <Link
                  key={i.href}
                  href={i.href}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2 text-sm transition hover:bg-accent"
                >
                  {i.label}
                </Link>
              ))}
            </div>
          )}
          <div className="border-t py-1">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm transition hover:bg-accent"
            >
              <SettingsIcon className="h-4 w-4" /> Settings
            </Link>
            <form action={signOutAction}>
              <button
                type="submit"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </form>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Account menu"
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-accent"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{roleLabel}</p>
        </div>
        <ChevronUp
          className={`h-4 w-4 shrink-0 text-muted-foreground transition ${open ? "" : "rotate-180"}`}
        />
      </button>
    </div>
  );
}
