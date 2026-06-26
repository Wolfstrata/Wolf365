import { getEnv } from "@/env";

/**
 * Minimal Neon control-plane API client used for database backups.
 *
 * A Neon "branch" is an instant copy-on-write snapshot of the whole database at
 * the moment of creation — that is our backup primitive. The control plane is a
 * public HTTPS API with no static-IP requirement, so we use the global `fetch`
 * (not the QuotaGuard-proxied connectorFetch) with a small retry on transient
 * failures.
 *
 * The API key is read from the environment and never logged.
 */

const NEON_API_BASE = "https://console.neon.tech/api/v2";

/** True when both env vars needed for Neon backups are present. */
export function isNeonConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.NEON_API_KEY && env.NEON_PROJECT_ID);
}

export interface NeonBranch {
  id: string;
  name: string;
  created_at?: string;
  /** Production/primary branch flag (Neon renamed `primary` → `default`). */
  default?: boolean;
  primary?: boolean;
}

function neonConfig(): { apiKey: string; projectId: string } {
  const env = getEnv();
  if (!env.NEON_API_KEY || !env.NEON_PROJECT_ID) {
    throw new Error("Neon backups are not configured (NEON_API_KEY / NEON_PROJECT_ID).");
  }
  return { apiKey: env.NEON_API_KEY, projectId: env.NEON_PROJECT_ID };
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

async function neonFetch(
  path: string,
  apiKey: string,
  init: RequestInit = {},
  attempt = 1,
): Promise<Response> {
  const res = await fetch(`${NEON_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (RETRYABLE.has(res.status) && attempt < 3) {
    await new Promise((r) => setTimeout(r, attempt * 1000));
    return neonFetch(path, apiKey, init, attempt + 1);
  }
  return res;
}

/** Read a concise error body without leaking secrets. */
async function describeError(res: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await res.json()) as { message?: string };
    detail = body?.message ? `: ${body.message}` : "";
  } catch {
    /* ignore non-JSON bodies */
  }
  return `Neon API ${res.status}${detail}`;
}

/** Create a branch (point-in-time snapshot) from the project's default branch. */
export async function createBranch(name: string): Promise<NeonBranch> {
  const { apiKey, projectId } = neonConfig();
  const res = await neonFetch(`/projects/${projectId}/branches`, apiKey, {
    method: "POST",
    body: JSON.stringify({ branch: { name } }),
  });
  if (!res.ok) throw new Error(await describeError(res));
  const data = (await res.json()) as { branch: NeonBranch };
  return data.branch;
}

/** List all branches in the project. */
export async function listBranches(): Promise<NeonBranch[]> {
  const { apiKey, projectId } = neonConfig();
  const res = await neonFetch(`/projects/${projectId}/branches`, apiKey, {
    method: "GET",
  });
  if (!res.ok) throw new Error(await describeError(res));
  const data = (await res.json()) as { branches: NeonBranch[] };
  return data.branches ?? [];
}

/** Delete a branch by id (used to prune expired backups). */
export async function deleteBranch(branchId: string): Promise<void> {
  const { apiKey, projectId } = neonConfig();
  const res = await neonFetch(`/projects/${projectId}/branches/${branchId}`, apiKey, {
    method: "DELETE",
  });
  // 404 = already gone; treat as success so pruning is idempotent.
  if (!res.ok && res.status !== 404) throw new Error(await describeError(res));
}

/**
 * Resolve the production branch id to restore INTO. Uses NEON_BRANCH_ID when
 * set, otherwise the project's default (a.k.a. primary) branch.
 */
export async function getDefaultBranchId(): Promise<string> {
  const override = getEnv().NEON_BRANCH_ID;
  if (override) return override;
  const branches = await listBranches();
  const def = branches.find((b) => b.default === true || b.primary === true);
  if (!def) {
    throw new Error("Could not determine the default Neon branch; set NEON_BRANCH_ID.");
  }
  return def.id;
}

/**
 * Restore `targetBranchId` to the state of `sourceBranchId`. `preserveName`
 * saves the target's CURRENT state as a new branch first (a safety backup), so
 * the restore is reversible. Returns the ids of the async operations to poll.
 */
export async function restoreBranch(opts: {
  targetBranchId: string;
  sourceBranchId: string;
  preserveName: string;
}): Promise<string[]> {
  const { apiKey, projectId } = neonConfig();
  const res = await neonFetch(
    `/projects/${projectId}/branches/${opts.targetBranchId}/restore`,
    apiKey,
    {
      method: "POST",
      body: JSON.stringify({
        source_branch_id: opts.sourceBranchId,
        preserve_under_name: opts.preserveName,
      }),
    },
  );
  if (!res.ok) throw new Error(await describeError(res));
  const data = (await res.json()) as { operations?: { id: string }[] };
  return (data.operations ?? []).map((o) => o.id);
}

/**
 * Best-effort poll of Neon operations until all finish or the timeout elapses.
 * Returns "finished", "failed", or "in_progress" (on timeout). Bounded so it
 * stays well under the calling route's maxDuration.
 */
export async function waitForOperations(
  operationIds: string[],
  timeoutMs = 20_000,
): Promise<"finished" | "failed" | "in_progress"> {
  if (operationIds.length === 0) return "finished";
  const { apiKey, projectId } = neonConfig();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const statuses = await Promise.all(
      operationIds.map(async (id) => {
        const res = await neonFetch(`/projects/${projectId}/operations/${id}`, apiKey, {
          method: "GET",
        });
        if (!res.ok) return "unknown";
        const data = (await res.json()) as { operation?: { status?: string } };
        return data.operation?.status ?? "unknown";
      }),
    );
    if (statuses.some((s) => s === "failed" || s === "error")) return "failed";
    if (statuses.every((s) => s === "finished")) return "finished";
    await new Promise((r) => setTimeout(r, 2000));
  }
  return "in_progress";
}
