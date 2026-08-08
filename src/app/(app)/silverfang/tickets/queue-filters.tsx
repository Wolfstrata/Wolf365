"use client";

import Link from "next/link";
import { Combobox } from "@/components/ui/combobox";

const SELECT_CLS =
  "mt-1 block w-48 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * The queue's filter bar.
 *
 * A client component only because the client and assignee pickers are
 * type-to-filter — with a couple of thousand clients, a native `<select>` can only
 * be searched by the first letters of the name, which is no use when you think of
 * the company as "Penner" and it is filed as "EG Penner Building Centres".
 *
 * Still a plain GET form: the filters stay in the URL, so a filtered queue is
 * linkable and the back button works. The comboboxes submit through hidden inputs,
 * which is why that did not have to change.
 */
export function QueueFilters({
  view,
  boards,
  users,
  clients,
  priorities,
  initial,
}: {
  view: string;
  boards: { id: string; name: string }[];
  users: { id: string; name: string; email: string }[];
  clients: { id: string; name: string }[];
  priorities: { value: string; label: string }[];
  initial: {
    q: string;
    board: string;
    priority: string;
    assignee: string;
    client: string;
  };
}) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="view" value={view} />
      <label className="block text-xs font-medium text-muted-foreground">
        Search
        <input
          name="q"
          defaultValue={initial.q}
          placeholder="Summary or #number"
          className="mt-1 block w-56 rounded-md border bg-background px-3 py-1.5 text-sm"
        />
      </label>

      <label className="block text-xs font-medium text-muted-foreground">
        Board
        <select name="board" defaultValue={initial.board} className={SELECT_CLS}>
          <option value="">All boards</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-xs font-medium text-muted-foreground">
        Priority
        <select name="priority" defaultValue={initial.priority} className={SELECT_CLS}>
          <option value="">Any</option>
          {priorities.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <div className="block text-xs font-medium text-muted-foreground">
        Assignee
        <div className="mt-1 w-48">
          <Combobox
            name="assignee"
            options={users.map((u) => ({ id: u.id, label: u.name, keywords: u.email }))}
            value={initial.assignee}
            placeholder="Anyone"
            emptyLabel="Anyone"
          />
        </div>
      </div>

      <div className="block text-xs font-medium text-muted-foreground">
        Client
        <div className="mt-1 w-56">
          <Combobox
            name="client"
            options={clients.map((c) => ({ id: c.id, label: c.name }))}
            value={initial.client}
            placeholder="All clients"
            emptyLabel="All clients"
          />
        </div>
      </div>

      <button className="rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent">
        Apply
      </button>
      <Link
        href="/silverfang/tickets"
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        Reset
      </Link>
    </form>
  );
}
