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

export {
  bridgeAutoPaging,
  deserializePage,
  listAll,
  toPageQuery,
  type Page,
  type PageParams,
  type SubscriptionPage,
  type SubscriptionStatusCounts,
} from "./pagination.js";

export {
  SubscriptionStatus,
  type Product,
  type ProductVat,
  type Plan,
  type BillingPeriod,
  type Subscription,
  type SubscriptionProduct,
  type SubscriptionCustomer,
  type SubscriptionCustomerBilling,
  type SubscriptionCustomerShipping,
  type CustomerInput,
  type CustomerInputBilling,
  type CustomerInputShipping,
  type Customer,
  type CreateSubscriptionParams,
  type CreateSubscriptionResponse,
  type UpdateBillingCycleParams,
  type MessageResponse,
  type CheckoutSucceededEvent,
  type CheckoutFailedEvent,
  type SubscriptionStatusChangedEvent,
  type ApiKeyCreatedEvent,
  type ApiKeyDeletedEvent,
  type ApiKeyExpiredEvent,
  type ApiKeyExpiringSoonEvent,
  type WebhookEvent,
  type WebhookEventType,
} from "./models/index.js";

export type { VerifyWebhookOptions } from "./resources/webhooks.js";

// ProductsResource/SubscriptionsResource/CustomersResource/WebhooksResource are intentionally NOT
// exported here — consumers reach them through suqo.products/.subscriptions/.customers/.webhooks,
// never by constructing one directly (SDK-SPEC.md §5's public surface never shows a resource
// class being constructed).
