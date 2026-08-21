import { SdkConfig } from "./config/index.js";
import type { SuqoEnvironment } from "./config/index.js";

/** Options accepted by {@link SuqoClient}'s constructor (SDK-SPEC.md §2, §4; addendum §5). */
export interface SuqoClientOptions {
  /** The seller's API key. Its prefix determines sandbox vs. live — see SDK-SPEC.md §2. */
  apiKey: string;
  /**
   * Optional explicit override. If set AND it disagrees with the key's inferred environment, the
   * constructor throws `SuqoConfigError`. Normally omit this.
   */
  baseUrl?: string;
  /**
   * Per-client default request timeout in milliseconds; per-call override also allowed by
   * `http.ts` (Ticket 2). Default 30_000. Named `timeout`, not `timeoutMs` — per SDK Naming Map
   * v1.1, SDK-surface fields drop the `Ms` suffix.
   */
  timeout?: number;
  /** Max retry attempts for idempotent reads (reads only — writes are never retried, SDK-SPEC.md §8, §12). Default 2. */
  maxRetries?: number;
  /** Advanced: custom undici dispatcher for connection-pool tuning, passed through opaquely (Ticket 2). */
  dispatcher?: unknown;
}

/**
 * The SUQO SDK client (SDK-SPEC.md §5).
 *
 * ```ts
 * const suqo = new SuqoClient({ apiKey: process.env.SUQO_API_KEY! });
 * ```
 *
 * The environment (sandbox vs. live) is inferred automatically from the key's prefix — nothing
 * else to configure in the common case (SDK-SPEC.md §2). Construction throws `SuqoConfigError`
 * immediately on a malformed key, or on a `baseUrl` override that disagrees with the key.
 *
 * This shell is deliberately thin for now: it resolves and holds configuration only.
 * `.products`/`.subscriptions`/`.customers`/`.webhooks` attach onto this same instance in a later
 * ticket, once `http.ts` exists for them to call through (docs/implementation-plan.md Ticket 4).
 */
export class SuqoClient {
  readonly #config: SdkConfig;

  constructor(options: SuqoClientOptions) {
    this.#config = new SdkConfig(options);
  }

  /** `"sandbox" | "live"` — inferred from the key prefix, never selected explicitly (SDK-SPEC.md §2). */
  get environment(): SuqoEnvironment {
    return this.#config.environment;
  }

  /** The resolved base URL this client sends requests to. */
  get baseUrl(): string {
    return this.#config.baseUrl;
  }

  /** The effective request timeout in milliseconds (default 30_000). */
  get timeout(): number {
    return this.#config.timeout;
  }

  /** The effective max retry count for idempotent reads (default 2). */
  get maxRetries(): number {
    return this.#config.maxRetries;
  }

  /** Redacts the key so it never appears in `JSON.stringify` output (SDK-SPEC.md §4). */
  toJSON(): Record<string, unknown> {
    return this.#config.toJSON();
  }

  /** Redacts the key so it never appears in `util.inspect`/`console.log` output (SDK-SPEC.md §4). */
  [Symbol.for("nodejs.util.inspect.custom")](): Record<string, unknown> {
    return this.toJSON();
  }
}
