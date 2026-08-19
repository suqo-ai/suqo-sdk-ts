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
  type SuqoErrorOptions,
  type KycRequiredErrorOptions,
  type ValidationErrorOptions,
  type FieldErrors,
  type RateLimitErrorOptions,
} from "./SuqoError.js";
export { mapHttpError, type HttpErrorInput } from "./mapHttpError.js";
