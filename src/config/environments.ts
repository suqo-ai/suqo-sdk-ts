/**
 * Environment → `baseUrl` resolution (RFC §9).
 *
 * @packageDocumentation
 */

/** The three environments {@link SdkConfig} can resolve a `baseUrl` from. */
export const SUQO_ENVIRONMENTS = ["production", "staging", "local"] as const;

/** `"production" | "staging" | "local"` — resolves `baseUrl` internally, never a raw URL. */
export type SuqoEnvironment = (typeof SUQO_ENVIRONMENTS)[number];

/**
 * Reads an environment-variable override without assuming `process` exists — this SDK also runs
 * in browsers (dashboard, checkout widgets), where `process` is undefined unless a bundler shims
 * it.
 */
function readEnvOverride(name: string): string | undefined {
  const env = typeof process !== "undefined" ? process.env : undefined;
  const value = env?.[name];
  return value !== undefined && value.length > 0 ? value : undefined;
}

/**
 * Default `baseUrl` per environment.
 *
 * TODO(Phase 0): replace with the finalized production/staging base URLs once backend/infra
 * confirms them (implementation-plan.md Phase 0). Until then, each falls back to the agreed
 * environment-variable stub (`SUQO_<ENV>_BASE_URL`) so Phase 1 isn't blocked on that decision
 * (RFC Phase 1 dependency note).
 */
export const DEFAULT_BASE_URLS: Readonly<Record<SuqoEnvironment, string>> = {
  production: readEnvOverride("SUQO_PRODUCTION_BASE_URL") ?? "https://api.suqo.com",
  staging: readEnvOverride("SUQO_STAGING_BASE_URL") ?? "https://staging-api.suqo.com",
  local: readEnvOverride("SUQO_LOCAL_BASE_URL") ?? "http://localhost:8000",
};

/**
 * Resolves the `baseUrl` for a given environment.
 *
 * `override`, when provided, always wins — it's the internal hook `SdkConfig` uses for
 * `__unsafeBaseUrlOverride` (local dev only; RFC §9). There is no public API that lets a caller
 * pass an arbitrary `baseUrl` alongside `environment` any other way.
 */
export function resolveBaseUrl(environment: SuqoEnvironment, override?: string): string {
  return override ?? DEFAULT_BASE_URLS[environment];
}
