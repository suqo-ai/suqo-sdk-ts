/**
 * SDK entry point — the single, complete public export surface (RFC §3, §4 "Clean public API").
 * Nothing outside this file's exports is part of the public contract.
 *
 * @packageDocumentation
 */

/** SDK version, stamped into request headers (keep in sync with package.json). */
export const VERSION = "0.0.1";

export {
  SdkConfig,
  type SdkConfigInput,
  SUQO_ENVIRONMENTS,
  type SuqoEnvironment,
} from "./config/index.js";

export {
  SDKError,
  AuthenticationError,
  PermissionError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  ServerError,
  NetworkError,
  TimeoutError,
  mapHttpError,
  type SDKErrorOptions,
  type ValidationErrorOptions,
  type ValidationIssue,
  type RateLimitErrorOptions,
  type TimeoutErrorOptions,
  type HttpErrorInput,
} from "./errors/index.js";
