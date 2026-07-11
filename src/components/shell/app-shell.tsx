"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu, X, PanelLeft, PanelLeftClose } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/components/shell/nav";
import { Sidebar } from "@/components/shell/sidebar";

/**
 * Responsive application shell.
 *
 * Desktop (lg+): the sidebar is a static left column, exactly as before.
 * Mobile/tablet (<lg): the sidebar becomes an off-canvas drawer opened by a
 * hamburger in a sticky top bar, with a backdrop; it closes on navigation,
 * backdrop tap, or Escape. The main work area is full-width underneath.
 */
export function AppShell({
  items,
  footer,
  children,
}: {
  items: NavItem[];
  footer: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Desktop-only: collapse the sidebar to reclaim width. Persisted across visits.
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Restore the collapsed preference on mount.
  useEffect(() => {
    if (localStorage.getItem("wolf365:nav-collapsed") === "1") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("wolf365:nav-collapsed", next ? "1" : "0");
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
  }

  // Escape closes the drawer.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const logo = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/Wolf365 Logo.png" alt="Wolf365 logo" className="h-auto w-3/4 object-contain" />
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Backdrop (mobile only, when open) */}
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        />
      )}

      {/* Sidebar: static column on desktop, off-canvas drawer on mobile */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] shrink-0 flex-col border-r bg-card transition-all duration-200 lg:static lg:z-auto lg:max-w-none lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
          collapsed ? "lg:w-0 lg:overflow-hidden lg:border-r-0" : "lg:w-72",
        )}
      >
        <div className="flex items-center justify-center border-b p-3">
          {logo}
          {/* Collapse (desktop) */}
          <button
            type="button"
            aria-label="Collapse menu"
            onClick={toggleCollapsed}
            className="absolute left-2 hidden rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground lg:inline-flex"
          >
            <PanelLeftClose className="h-5 w-5" />
          </button>
          {/* Close (mobile drawer) */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute right-2 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tapping a nav link closes the drawer on mobile. */}
        <div onClick={() => setOpen(false)} className="flex min-h-0 flex-1 flex-col">
          <Sidebar items={items} />
        </div>

        {footer}
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile top bar with hamburger */}
        <div className="flex items-center gap-3 border-b bg-card px-4 py-2.5 lg:hidden">
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/Wolf365 Logo.png" alt="Wolf365" className="h-6 w-auto object-contain" />
        </div>

        {/* Desktop expand button — shown only while the sidebar is collapsed */}
        {collapsed && (
          <div className="hidden items-center border-b bg-card px-3 py-2 lg:flex">
            <button
              type="button"
              aria-label="Expand menu"
              onClick={toggleCollapsed}
              className="inline-flex items-center gap-2 rounded-md p-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <PanelLeft className="h-5 w-5" />
              <span className="text-xs font-medium">Menu</span>
            </button>
          </div>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto bg-background">{children}</main>
      </div>
    </div>
  );
}
