/**
 * Key-prefix → environment/base-URL inference (SDK-SPEC.md §2).
 *
 * @packageDocumentation
 */
import { SuqoConfigError } from "../errors/SuqoError.js";

/** The two environments a key prefix resolves to. Never selected explicitly — always inferred. */
export type SuqoEnvironment = "sandbox" | "live";

const SANDBOX_BASE_URL = "https://test-be.suqo.ai";
const LIVE_BASE_URL = "https://be.suqo.ai";

/**
 * Ordered prefix → environment table. `su_test_key_` MUST be checked before `su_key_`
 * (SDK-SPEC.md §2 rule 4) — the spec calls this out explicitly as an ordering requirement for any
 * prefix matcher, so the order here is deliberate, not incidental.
 */
const KEY_PREFIXES: ReadonlyArray<{ prefix: string; environment: SuqoEnvironment; baseUrl: string }> = [
  { prefix: "su_test_key_", environment: "sandbox", baseUrl: SANDBOX_BASE_URL },
  { prefix: "su_key_", environment: "live", baseUrl: LIVE_BASE_URL },
];

/** Result of inferring an environment + base URL from an API key. */
export interface ResolvedEnvironment {
  environment: SuqoEnvironment;
  baseUrl: string;
}

/**
 * Infers the environment and base URL from an API key's prefix — the whole configuration in the
 * common case, no environment flag needed (SDK-SPEC.md §2).
 *
 * @param apiKey - The full API key. Matched with `startsWith`, treating the prefix as "starts
 * with", never a substring search anywhere in the key.
 * @param override - An explicit `baseUrl`, if the caller supplied one. Must agree with the
 * inferred base URL or this throws — silence-and-trust-one is forbidden (SDK-SPEC.md §2 rule 3).
 *
 * @throws {SuqoConfigError} if `apiKey` matches neither prefix (rule 2), or if `override` is
 * supplied and disagrees with the inferred base URL (rule 3). Thrown before any request is made.
 */
export function resolveEnvironment(apiKey: string, override?: string): ResolvedEnvironment {
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new SuqoConfigError("A SUQO API key is required.");
  }

  const match = KEY_PREFIXES.find(({ prefix }) => apiKey.startsWith(prefix));
  if (!match) {
    throw new SuqoConfigError(
      'Malformed SUQO API key: expected prefix "su_key_" (live) or "su_test_key_" (sandbox).',
    );
  }

  if (override !== undefined && override !== match.baseUrl) {
    throw new SuqoConfigError(
      `Environment mismatch: key implies ${match.baseUrl} but baseUrl was set to ${override}. ` +
        "Remove baseUrl or use a matching key.",
    );
  }

  return { environment: match.environment, baseUrl: override ?? match.baseUrl };
}
