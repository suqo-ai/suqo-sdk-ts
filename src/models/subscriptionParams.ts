import type { CustomerInput } from "./Customer.js";
import { SubscriptionStatus } from "./Subscription.js";

/**
 * Input/response shapes for the `subscriptions` write methods (`specs/openapi.yaml`
 * `CreateSubscriptionRequest`/`CreateSubscriptionResponse`/`UpdateBillingCycleRequest`). The two
 * input types are named `*Params`, not `*Request` — SDK Naming Map v1.1 §12: "Request" reads as
 * an HTTP request object, not an SDK input. `CreateSubscriptionResponse` is unaffected; the rename
 * only applies to inbound shapes.
 *
 * @packageDocumentation
 */

/**
 * What `subscriptions.create(params)` accepts (`openapi.yaml` `CreateSubscriptionRequest`,
 * renamed).
 */
export interface CreateSubscriptionParams {
  /** Plan billing period public id — from `products.list()`'s `plan[].billingPeriods[].pbpId`. */
  pbpId: string;
  /** Where the buyer returns after checkout. Not proof of payment — SDK-SPEC.md §5. */
  returnUrl: string;
  /** The buyer — renamed from the wire's `client` (SDK Naming Map v1.1 §11). */
  customer: CustomerInput;
}

/** What `subscriptions.create()` returns (`openapi.yaml` `CreateSubscriptionResponse` — name unchanged). */
export interface CreateSubscriptionResponse {
  subscriptionId: string;
  /** Echoed back from the request. */
  pbpId: string;
  /** Always this value immediately after creation. */
  status: typeof SubscriptionStatus.PendingCheckout;
  /** `<FRONTEND_URL>/pay/<subscriptionId>` — redirect the buyer here. Not proof of payment. */
  checkoutUrl: string;
  /** `null` until payment. */
  nextBillingCycle: string | null;
  createdAt: string;
}

/**
 * What `subscriptions.updateBillingCycle(params)` accepts (`openapi.yaml`
 * `UpdateBillingCycleRequest`, renamed). Collection-level action — the id travels in the body,
 * not the path, mirroring the wire (SDK Naming Map v1.1 §04).
 */
export interface UpdateBillingCycleParams {
  /** Must belong to the authenticated seller. */
  subscriptionId: string;
  /** `YYYY-MM-DD` — today or a future date. */
  nextBillingCycle: string;
}
