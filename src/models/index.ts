/**
 * Every SDK-surface model type (SDK-SPEC.md §5; SDK Naming Map v1.1 §06 "Model types"). Wire
 * names, wire shapes, and enum values are untouched (R1) — only field casing and the four
 * registered renames (`client`→`customer`, `Message`→`MessageResponse`, `*Request`→`*Params`,
 * `PaginationEnvelope`→`Page`) differ from `specs/openapi.yaml`.
 *
 * One deliberate exception: the `*Event` webhook payload types (`./WebhookEvent.js`) stay
 * snake_case — `webhooks.verify()` (Ticket 5) never parses the body itself, so there's no
 * deserialization step to do the camelCase conversion; see that file's own doc for why.
 *
 * @packageDocumentation
 */
export type { Product, ProductVat, Plan, BillingPeriod } from "./Product.js";
export { SubscriptionStatus } from "./Subscription.js";
export type { Subscription, SubscriptionProduct } from "./Subscription.js";
export type {
  SubscriptionCustomer,
  SubscriptionCustomerBilling,
  SubscriptionCustomerShipping,
  CustomerInput,
  CustomerInputBilling,
  CustomerInputShipping,
  Customer,
} from "./Customer.js";
export type {
  CreateSubscriptionParams,
  CreateSubscriptionResponse,
  UpdateBillingCycleParams,
} from "./subscriptionParams.js";
export type { MessageResponse } from "./MessageResponse.js";
export type {
  CheckoutSucceededEvent,
  CheckoutFailedEvent,
  SubscriptionStatusChangedEvent,
  WebhookEvent,
  WebhookEventType,
} from "./WebhookEvent.js";
