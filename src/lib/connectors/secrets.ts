/**
 * Per-environment connector secret storage.
 *
 * Connectors that have an `environment` config field (QuickBooks, TD SYNNEX)
 * need DIFFERENT credentials and OAuth tokens for Sandbox vs Production. Storing
 * a single shared credential slot was confusing and forced re-entry every time
 * the environment was switched.
 *
 * We namespace the encrypted secret bag by environment:
 *
 *   { "__env": { "sandbox": { clientId, ... }, "production": { ... } } }
 *
 * Connectors without an environment (Hudu, SuperOps) keep a flat bag. Legacy
 * flat bags for env-scoped connectors are migrated lazily into the currently
 * selected environment, so existing connections keep working.
 */

const ENV_KEY = "__env";

type Bag = Record<string, unknown>;

/** True when this connector's secrets should be namespaced by environment. */
export function isEnvScoped(config: Bag): boolean {
  return (
    typeof config.environment === "string" && config.environment.length > 0
  );
}

function activeEnv(config: Bag): string {
  return String(config.environment);
}

// --- Per-environment NON-SECRET config (base URL, token URL, paths, region) --
//
// Stored shape for env-scoped connectors:
//   { environment: "sandbox", __env: { sandbox: {...}, production: {...} } }
// The `environment` selector stays at the top level; everything else is keyed
// by environment so each environment remembers its own settings.

/** Effective flat config for the active environment ({ environment, ...fields }). */
export function getEnvConfig(stored: Bag): Bag {
  if (!isEnvScoped(stored)) return stored;
  const env = activeEnv(stored);
  const map = stored[ENV_KEY];
  if (map && typeof map === "object") {
    const fields = ((map as Record<string, Bag>)[env] as Bag) ?? {};
    return { environment: env, ...fields };
  }
  // Legacy flat config: all fields (except environment) belong to this env.
  const { [ENV_KEY]: _omit, environment: _e, ...rest } = stored;
  return { environment: env, ...rest };
}

/** Write the active environment's non-secret config fields, preserving others. */
export function setEnvConfig(stored: Bag, env: string, fields: Bag): Bag {
  let map: Record<string, Bag> = {};
  const existing = stored[ENV_KEY];
  if (existing && typeof existing === "object") {
    map = { ...(existing as Record<string, Bag>) };
  } else {
    // Migrate legacy flat config into the environment it was last used as.
    const { [ENV_KEY]: _omit, environment: prevEnv, ...rest } = stored;
    if (Object.keys(rest).length > 0) map[String(prevEnv ?? env)] = rest;
  }
  map[env] = fields;
  return { environment: env, [ENV_KEY]: map };
}

/** Read the flat secret bag for the connector's active environment. */
export function getEnvSecrets(stored: Bag, config: Bag): Bag {
  if (!isEnvScoped(config)) return stored;
  const env = activeEnv(config);
  const envMap = stored[ENV_KEY];
  if (envMap && typeof envMap === "object") {
    return ((envMap as Record<string, Bag>)[env] as Bag) ?? {};
  }
  // Legacy flat bag: treat it as belonging to the current environment.
  const { [ENV_KEY]: _omit, ...flat } = stored;
  return flat;
}

/**
 * Produce the full stored object after writing `next` as the active
 * environment's secrets (preserving the other environment's secrets).
 */
export function setEnvSecrets(stored: Bag, config: Bag, next: Bag): Bag {
  if (!isEnvScoped(config)) return next;
  const env = activeEnv(config);

  let envMap: Record<string, Bag> = {};
  const existing = stored[ENV_KEY];
  if (existing && typeof existing === "object") {
    envMap = { ...(existing as Record<string, Bag>) };
  } else {
    // Migrate a legacy flat bag into whichever environment it was being used as.
    const { [ENV_KEY]: _omit, ...flat } = stored;
    if (Object.keys(flat).length > 0) envMap[env] = flat;
  }
  envMap[env] = next;
  return { [ENV_KEY]: envMap };
}
