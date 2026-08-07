/**
 * Working out which client an unrecognised sender belongs to.
 *
 * The mail ingest already refused these addresses: no contact holds them and no
 * other contact shares the domain. So this is a *suggestion* engine for a human
 * to confirm, not an authority — it exists so that clearing the unrecognised-sender
 * list is one click per sender instead of a client picker and a name form.
 *
 * Three tiers, strongest first, and the tier is always reported so the operator
 * can see whether they are confirming evidence or a guess:
 *
 *  1. `domain`  — a synced SuperOps client lists this exact email domain. That is
 *                 recorded fact about the account, not inference.
 *  2. `name`    — the domain's root matches a client name once both are reduced to
 *                 letters and digits ("mcfaddenbenefits.com" ≡ "McFadden Benefits").
 *  3. `partial` — one contains the other, which catches "egpennerlumber.com" for
 *                 "EG Penner" but is weak enough that it is labelled as a guess.
 *
 * Pure and tested. Attaching a person to the wrong company is the failure mode
 * here, and an ambiguous match must resolve to *no suggestion* rather than to
 * whichever client happened to sort first.
 */

export type SuggestionTier = "domain" | "name" | "partial";

export interface ClientChoice {
  id: string;
  name: string;
}

export interface Suggestion {
  clientId: string;
  clientName: string;
  tier: SuggestionTier;
}

/**
 * Two-part public suffixes we need to see past. Not a full PSL — this only has to
 * find a company's own label, and getting it wrong costs a suggestion, not data.
 */
const COMPOUND_SUFFIXES = [
  "co.uk",
  "org.uk",
  "ac.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.za",
  "com.br",
  "co.jp",
  "com.mx",
];

/**
 * The company's own label in a domain: `mail.mcfaddenbenefits.com` →
 * `mcfaddenbenefits`, `foo.co.uk` → `foo`.
 */
export function domainRoot(domain: string | null | undefined): string {
  const clean = (domain ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!clean) return "";
  const compound = COMPOUND_SUFFIXES.find((s) => clean.endsWith(`.${s}`));
  const withoutSuffix = compound
    ? clean.slice(0, -(compound.length + 1))
    : clean.replace(/\.[a-z]{2,}$/, "");
  const labels = withoutSuffix.split(".").filter(Boolean);
  // The last remaining label is the company; anything before it is a subdomain.
  return labels[labels.length - 1] ?? "";
}

/** A name reduced to comparable form: lower case, letters and digits only. */
export function companyKey(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Words that say nothing about which company this is, so they are dropped before
 * comparing. "Penner Ltd" and "Penner" are the same company.
 */
const NOISE = /(inc|llc|ltd|limited|corp|corporation|company|co|group|holdings|plc)$/;

function comparableName(name: string): string {
  const key = companyKey(name);
  // Only one pass: "Foo Co Ltd" is rare enough not to warrant looping, and looping
  // would eventually eat a company genuinely called "Group".
  const stripped = key.replace(NOISE, "");
  return stripped.length >= 3 ? stripped : key;
}

/**
 * Suggest the client that owns an email domain.
 *
 * `domainOwners` maps an email domain to the client that declares it (from the
 * SuperOps sync). It wins outright — a recorded domain is not a guess.
 *
 * Returns null when nothing matches **and** when more than one client matches at
 * the same tier. Ambiguity here means the operator has to choose, which is the
 * correct outcome; picking one would be a coin flip that attaches somebody's
 * contact to the wrong company.
 */
export function suggestClientForDomain(input: {
  domain: string | null | undefined;
  clients: ClientChoice[];
  domainOwners?: Record<string, string>;
}): Suggestion | null {
  const domain = (input.domain ?? "").trim().toLowerCase();
  if (!domain) return null;

  const owned = input.domainOwners?.[domain];
  if (owned) {
    const client = input.clients.find((c) => c.id === owned);
    if (client) return { clientId: client.id, clientName: client.name, tier: "domain" };
  }

  const root = domainRoot(domain);
  if (root.length < 3) return null;

  const exact = input.clients.filter((c) => comparableName(c.name) === root);
  if (exact.length === 1) {
    return { clientId: exact[0]!.id, clientName: exact[0]!.name, tier: "name" };
  }
  if (exact.length > 1) return null;

  const partial = input.clients.filter((c) => {
    const key = comparableName(c.name);
    if (key.length < 3) return false;
    return root.includes(key) || key.includes(root);
  });
  if (partial.length === 1) {
    return { clientId: partial[0]!.id, clientName: partial[0]!.name, tier: "partial" };
  }
  return null;
}

/** How a suggestion's strength reads in the UI. */
export function describeTier(tier: SuggestionTier): string {
  switch (tier) {
    case "domain":
      return "domain listed on the client in SuperOps";
    case "name":
      return "domain matches the client name";
    case "partial":
      return "domain looks like the client name — check it";
  }
}

export interface SenderEventLike {
  address: string;
  subject: string | null;
  at: Date;
  mailbox: string | null;
}

export interface SenderGroup {
  address: string;
  domain: string;
  /** How many messages from this address were refused. */
  count: number;
  /** Most recent refusal, which is what the list sorts on. */
  lastAt: Date;
  /** Subject of the most recent one, for recognising what it was. */
  lastSubject: string | null;
  mailbox: string | null;
}

/**
 * Collapse refused messages into one row per sender.
 *
 * The raw log repeats a sender once per message — the same address three times in
 * a row is normal, because a person who emails and gets no reply emails again.
 * Fixing it is one decision per *person*, so the triage list is grouped and the
 * count is shown instead.
 */
export function groupUnknownSenders(events: SenderEventLike[]): SenderGroup[] {
  const groups = new Map<string, SenderGroup>();

  for (const e of events) {
    const address = e.address.trim().toLowerCase();
    if (!address) continue;
    const existing = groups.get(address);
    if (!existing) {
      groups.set(address, {
        address,
        domain: address.split("@")[1] ?? "",
        count: 1,
        lastAt: e.at,
        lastSubject: e.subject,
        mailbox: e.mailbox,
      });
      continue;
    }
    existing.count += 1;
    if (e.at.getTime() > existing.lastAt.getTime()) {
      existing.lastAt = e.at;
      existing.lastSubject = e.subject;
      existing.mailbox = e.mailbox;
    }
  }

  return [...groups.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}
