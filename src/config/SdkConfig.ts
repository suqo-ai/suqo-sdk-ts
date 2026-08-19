import { resolveEnvironment, type SuqoEnvironment } from "./environments.js";

/** Input accepted by {@link SdkConfig} — the same shape `SuqoClient`'s constructor takes (addendum §5). */
export interface SdkConfigInput {
  /** The seller's API key. Its prefix determines the environment (SDK-SPEC.md §2) — never passed separately. */
  apiKey: string;
  /**
   * Optional explicit override. If set AND it disagrees with the key prefix, the constructor
   * throws `SuqoConfigError`. Normally omit this.
   */
  baseUrl?: string;
  /** Per-client default; per-call override also allowed by `http.ts` (Ticket 2). Default 30_000. */
  timeoutMs?: number;
  /** Read-retry tuning (reads only — writes are never retried, SDK-SPEC.md §8, §12). Default 2. */
  maxRetries?: number;
  /** Advanced: custom undici dispatcher for pool tuning, passed through opaquely to `fetch` (Ticket 2). */
  dispatcher?: unknown;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;

/** The `util.inspect` custom-inspection symbol, referenced by key so this file never needs to `import "node:util"`. */
const NODE_INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");

/**
 * Resolved, immutable SDK configuration (SDK-SPEC.md §2, §4).
 *
 * Validated at construction time — a malformed key or a conflicting `baseUrl` override throws
 * `SuqoConfigError` immediately, before any request is ever made. The API key is stored in a
 * private class field, never a public/enumerable property, so it can never leak through
 * `JSON.stringify`, `console.log`, or `util.inspect` (SDK-SPEC.md §4) — `toJSON` and the
 * `util.inspect` custom-inspection symbol both redact it explicitly as well, so redaction holds
 * even if a future refactor adds an enumerable field.
 *
 * @example
 * ```ts
 * const config = new SdkConfig({ apiKey: "su_test_key_..." });
 * config.baseUrl;     // => "https://test.be.suqo.ai"
 * config.environment; // => "sandbox"
 * ```
 */
export class SdkConfig {
  /** `"sandbox" | "live"` — inferred from the key prefix, never selected explicitly. */
  readonly environment: SuqoEnvironment;
  /** The resolved base URL for this environment (or the caller's override, if it agreed). */
  readonly baseUrl: string;
  /** Request timeout in milliseconds, per-client default (`http.ts` in Ticket 2 allows a per-call override). */
  readonly timeoutMs: number;
  /** Max retry attempts for idempotent reads. Writes are never retried regardless of this value. */
  readonly maxRetries: number;
  /** Opaque custom dispatcher for pool tuning, if supplied. Passed through to `fetch` unexamined. */
  readonly dispatcher: unknown;

  readonly #apiKey: string;

  constructor(input: SdkConfigInput) {
    const { environment, baseUrl } = resolveEnvironment(input.apiKey, input.baseUrl);
    this.environment = environment;
    this.baseUrl = baseUrl;
    this.timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = input.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.dispatcher = input.dispatcher;
    this.#apiKey = input.apiKey;
  }

  /** The raw API key, for building the `Authorization: Bearer <key>` header (`http.ts`, Ticket 2). Never logged. */
  get apiKey(): string {
    return this.#apiKey;
  }

  /** Redacts the key so it never appears in `JSON.stringify` output (SDK-SPEC.md §4). */
  toJSON(): Record<string, unknown> {
    return {
      environment: this.environment,
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      apiKey: "[redacted]",
    };
  }

  /** Redacts the key so it never appears in `util.inspect`/`console.log` output (SDK-SPEC.md §4). */
  [NODE_INSPECT_CUSTOM](): Record<string, unknown> {
    return this.toJSON();
  }
}
