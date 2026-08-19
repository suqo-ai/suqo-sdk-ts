/**
 * SDK entry point — the single, complete public export surface (SDK-SPEC.md §5).
 * Nothing outside this file's exports is part of the public contract.
 *
 * @packageDocumentation
 */

/** SDK version, stamped into request headers (keep in sync with package.json). */
export const VERSION = "0.0.1";

export {
  SuqoError,
  SuqoConfigError,
  AuthenticationError,
  KycRequiredError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  ServerError,
  NetworkError,
  mapHttpError,
  type SuqoErrorOptions,
  type KycRequiredErrorOptions,
  type ValidationErrorOptions,
  type FieldErrors,
  type RateLimitErrorOptions,
  type HttpErrorInput,
} from "./errors/index.js";

export { SuqoClient, type SuqoClientOptions } from "./client.js";
export type { SuqoEnvironment } from "./config/index.js";

// .products/.subscriptions/.customers/.webhooks attach onto SuqoClient in a later ticket
// (see docs/implementation-plan.md Ticket 4).
