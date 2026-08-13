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
  type SDKErrorOptions,
  type ValidationErrorOptions,
  type ValidationIssue,
  type RateLimitErrorOptions,
  type TimeoutErrorOptions,
} from "./SDKError.js";
export { mapHttpError, type HttpErrorInput } from "./mapHttpError.js";
