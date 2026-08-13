import { z } from "zod";
import { ValidationError } from "../errors/SDKError.js";
import { resolveBaseUrl, SUQO_ENVIRONMENTS, type SuqoEnvironment } from "./environments.js";

/**
 * Input accepted by {@link SdkConfig}.
 *
 * `baseUrl` is deliberately not a field here — only `environment` resolves it, or
 * `__unsafeBaseUrlOverride` for local development, so a typo can never silently point a
 * production partner integration at the wrong host (RFC §9).
 */
export interface SdkConfigInput {
  /** `"production" | "staging" | "local"` — resolves `baseUrl` internally. */
  environment: SuqoEnvironment;
  /**
   * Escape hatch for local development only. Bypasses the `environment` → `baseUrl` table
   * entirely. Deliberately verbose/awkward to type so it can't be reached by accident (RFC §9,
   * implementation-plan.md Phase 10 exit criteria).
   *
   * @internal
   */
  __unsafeBaseUrlOverride?: string;
}

/** Zod schema `SdkConfig` validates its input against at construction time (RFC Best Practice #18). */
const sdkConfigInputSchema = z.object({
  environment: z.enum(SUQO_ENVIRONMENTS, {
    message: `\`environment\` must be one of: ${SUQO_ENVIRONMENTS.join(", ")}`,
  }),
  __unsafeBaseUrlOverride: z
    .string()
    .url("`__unsafeBaseUrlOverride` must be a valid absolute URL")
    .optional(),
});

/** Converts a Zod validation failure into the SDK's own {@link ValidationError}, never a raw `ZodError`. */
function toValidationError(error: z.ZodError): ValidationError {
  const issues = error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  return new ValidationError("Invalid SDK configuration.", { issues });
}

/**
 * Resolved, immutable SDK configuration.
 *
 * Validated at construction time — an invalid `SdkConfigInput` throws a {@link ValidationError}
 * immediately, before any request is ever made (RFC Best Practice #18: fail fast, not on first
 * request).
 *
 * This is the contract Phase 1 - Part 2 (`HttpCore`) builds on: `environment` and `baseUrl` are
 * stable and will only ever gain additional fields (e.g. `timeoutMs`, `retry`, `logger`) in later
 * parts, never change shape.
 *
 * @example
 * ```ts
 * const config = new SdkConfig({ environment: "production" });
 * config.baseUrl; // => "https://api.suqo.com"
 * ```
 */
export class SdkConfig {
  /** `"production" | "staging" | "local"`. */
  readonly environment: SuqoEnvironment;
  /** The resolved base URL for this environment (or the `__unsafeBaseUrlOverride`, if given). */
  readonly baseUrl: string;

  constructor(input: SdkConfigInput) {
    const parsed = sdkConfigInputSchema.safeParse(input);
    if (!parsed.success) throw toValidationError(parsed.error);

    this.environment = parsed.data.environment;
    this.baseUrl = resolveBaseUrl(parsed.data.environment, parsed.data.__unsafeBaseUrlOverride);
  }
}
