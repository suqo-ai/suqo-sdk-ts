/**
 * Every SDK-surface model type (SDK-SPEC.md §5; SDK Naming Map v1.1 §06 "Model types"). Wire
 * names, wire shapes, and enum values are untouched (R1) — only field casing and the four
 * registered renames (`client`→`customer`, `Message`→`MessageResponse`, `*Request`→`*Params`,
 * `PaginationEnvelope`→`Page`) differ from `specs/openapi.yaml`.
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
