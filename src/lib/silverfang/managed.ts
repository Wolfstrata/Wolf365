/**
 * Deciding which SuperOps customers are managed-services customers.
 *
 * SuperOps carries no boolean for this. What it has is free text — a client
 * `stage`, a client `status`, and contract names — typed by whoever set the
 * account up. So the classification is string matching, and the only honest way
 * to ship string matching against production data is to (a) keep it pure and
 * tested, (b) return *why* it matched so the operator can audit the result
 * before agreements are written, and (c) let an explicit "unmanaged" label beat
 * any positive signal.
 *
 * The output is a suggestion. Nothing here writes anything; the caller creates a
 * draft-quality agreement the user is expected to go and edit.
 */

/** The agreement types this classifier can suggest. */
export type ManagedKind = "MANAGED_SERVICES" | "MANAGED_NOC";

export interface ManagedSignals {
  /** SuperOps client `stage` — usually the account lifecycle label. */
  stage?: string | null;
  /** SuperOps client `status`. */
  status?: string | null;
  /** Names of the client's contracts, with their SuperOps status. */
  contracts?: { name?: string | null; status?: string | null }[];
}

export interface ManagedVerdict {
  /** The agreement type to create, or null to leave this client alone. */
  kind: ManagedKind | null;
  /** Where the decision came from — shown in the preview, never invented. */
  source: "stage" | "status" | "contract" | "excluded" | "none";
  /** The exact source text that decided it, for the preview table. */
  label: string | null;
}

/** Labels that mean "explicitly not managed", which outrank any positive match. */
const NEGATIVE = /\b(?:un ?managed|not managed|non managed|no longer managed)\b/;

/** Contract statuses that mean the contract no longer says anything about today. */
const DEAD_CONTRACT = /\b(?:cancel(?:led|ed)?|terminated|expired|ended|inactive|void)\b/;

/** Lower-case, punctuation to spaces, whitespace collapsed. */
function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * What one label says. `"negative"` is distinct from `null`: "Unmanaged" is a
 * statement that this client is out, whereas "Prospect" simply says nothing.
 */
function readLabel(value: string | null | undefined): ManagedKind | null | "negative" {
  const text = normalize(value);
  if (!text) return null;
  if (NEGATIVE.test(text)) return "negative";
  // NOC only wins when the label actually says NOC *and* says managed, so a
  // "Managed Services" client with a NOC monitoring add-on stays MANAGED_SERVICES.
  if (/\bnoc\b/.test(text) && /\bmanaged\b/.test(text)) return "MANAGED_NOC";
  if (/\bmanaged\b/.test(text)) return "MANAGED_SERVICES";
  return null;
}

/**
 * Classify one client.
 *
 * Order matters: client-level labels are checked before contracts (a stage is a
 * deliberate statement about the account; a contract name is inference), and an
 * exclusion anywhere in the client-level labels ends it.
 */
export function classifyManaged(signals: ManagedSignals): ManagedVerdict {
  const clientLevel: { source: "stage" | "status"; value: string | null | undefined }[] = [
    { source: "stage", value: signals.stage },
    { source: "status", value: signals.status },
  ];

  for (const { value } of clientLevel) {
    if (readLabel(value) === "negative") {
      return { kind: null, source: "excluded", label: value?.trim() || null };
    }
  }

  for (const { source, value } of clientLevel) {
    const verdict = readLabel(value);
    if (verdict === "MANAGED_SERVICES" || verdict === "MANAGED_NOC") {
      return { kind: verdict, source, label: value!.trim() };
    }
  }

  for (const contract of signals.contracts ?? []) {
    if (DEAD_CONTRACT.test(normalize(contract.status))) continue;
    const verdict = readLabel(contract.name);
    if (verdict === "MANAGED_SERVICES" || verdict === "MANAGED_NOC") {
      return { kind: verdict, source: "contract", label: contract.name!.trim() };
    }
  }

  return { kind: null, source: "none", label: null };
}

const KIND_LABEL: Record<ManagedKind, string> = {
  MANAGED_SERVICES: "Managed Services",
  MANAGED_NOC: "Managed NOC",
};

/** How the verdict reads in the preview table. */
export function describeVerdict(verdict: ManagedVerdict): string {
  switch (verdict.source) {
    case "excluded":
      return `Excluded — labelled "${verdict.label}" in SuperOps`;
    case "none":
      return "No managed-services signal in SuperOps";
    case "contract":
      return `${KIND_LABEL[verdict.kind!]} — from contract "${verdict.label}"`;
    default:
      return `${KIND_LABEL[verdict.kind!]} — from ${verdict.source} "${verdict.label}"`;
  }
}

/**
 * The agreement to create for a matched client: a placeholder term the user
 * fills in later.
 *
 * `DRAFT`, not `ACTIVE`. The user asked for these so managed customers are
 * tagged and editable, and every money field here (monthly amount, included
 * hours, rates) is unknown — an ACTIVE agreement with no amount would flow
 * straight into billing runs as a real zero-dollar agreement. DRAFT tags the
 * client, shows up everywhere agreements are listed, and cannot bill until a
 * human has been through it.
 */
export function defaultManagedAgreement(input: {
  clientName: string;
  kind: ManagedKind;
  startDate: Date;
  endDate: Date;
  reason: string;
}): {
  name: string;
  type: ManagedKind;
  status: "DRAFT";
  startDate: Date;
  endDate: Date;
  autoRenew: boolean;
  billingFrequency: string;
  notes: string;
} {
  return {
    name: `${KIND_LABEL[input.kind]} — ${input.clientName}`,
    type: input.kind,
    status: "DRAFT",
    startDate: input.startDate,
    endDate: input.endDate,
    autoRenew: false,
    billingFrequency: "MONTHLY",
    notes:
      `Auto-created from SuperOps on ${input.startDate.toISOString().slice(0, 10)}. ` +
      `${input.reason}. Placeholder 1-year term — set the monthly amount, included ` +
      `hours, overage and standard rates, then move it to Active.`,
  };
}

/** Midnight UTC on the given instant's date, so terms don't carry a time of day. */
export function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}
