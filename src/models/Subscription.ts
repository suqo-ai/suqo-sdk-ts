import type { SubscriptionCustomer } from "./Customer.js";

/**
 * `Subscription`'s model types (`specs/openapi.yaml` `Subscription`/`SubscriptionProduct`/
 * `SubscriptionStatus` — SDK-SPEC.md §5).
 *
 * @packageDocumentation
 */

/**
 * The subscription lifecycle enum (`openapi.yaml` `SubscriptionStatus`). Wire values are
 * invariant (R1); this is a constant object + derived union, not a TypeScript `enum` — a plain
 * union alone can't be iterated/round-tripped the way SDK Naming Map v1.1 §10 requires: "decoders
 * must round-trip an unknown value rather than raising," so an unrecognized status the API adds
 * later (before this SDK's next release) passes through as a plain string instead of throwing.
 */
export const SubscriptionStatus = {
  /** Newly created; the buyer hasn't paid yet. */
  PendingCheckout: "pending_checkout",
  /** Currently active. */
  Active: "active",
  /** `nextBillingCycle` passed with no payment yet. */
  Due: "due",
  /** Cancelled immediately (user-prompted). */
  Cancelled: "cancelled",
  /** Scheduled to cancel at the end of the current billing cycle — see SDK-SPEC.md §5's `cancel` note. */
  PendingCancellation: "pending_cancellation",
  /** Auto-ended after a grace period without payment. */
  Inactive: "inactive",
} as const;

/**
 * Any known {@link SubscriptionStatus} wire value, OR an arbitrary string. The `& {}` intersection
 * is deliberate, not a typo — a bare `string` union member would collapse the whole type to
 * `string` and lose autocomplete for the known values; this keeps both: editor autocomplete
 * suggests the six known values, but an unrecognized one the API adds later still assigns without
 * a cast, satisfying the module doc's round-trip requirement at the type level too, not just at
 * runtime.
 */
// This is the "loose autocomplete" idiom (see the doc comment above), not an accidental `{}`. The
// lint rule's own suggested fix, `NonNullable<unknown>`, resolves to plain `unknown`, and
// `string & unknown` collapses right back to `string` — throwing away exactly the
// autocomplete-for-known-values this type exists to keep.
// eslint-disable-next-line @typescript-eslint/ban-types
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus] | (string & {});

/** The product summary embedded on a {@link Subscription} (`openapi.yaml` `SubscriptionProduct`) — a summary, not the full {@link import("./Product.js").Product} record. */
export interface SubscriptionProduct {
  productId: string;
  name: string;
  planName: string;
  /** Pass this to `subscriptions.create({ pbpId, ... })`. */
  pbpId: string;
  label: string;
  /** Decimal string. Never coerced to a number — SDK-SPEC.md §5. */
  price: string;
  currency: string;
}

/** A seller's subscription (`openapi.yaml` `Subscription`). */
export interface Subscription {
  subscriptionId: string;
  status: SubscriptionStatus;
  /** `true` iff `status === SubscriptionStatus.Active`. */
  isActive: boolean;
  /** The buyer, in the read shape — renamed from the wire's `client` (SDK Naming Map v1.1 §11). */
  customer: SubscriptionCustomer;
  product: SubscriptionProduct;
  currentPeriodStart: string | null;
  /** Equals `nextBillingCycle`. */
  currentPeriodEnd: string | null;
  /** The date this subscription bills next (same value as `currentPeriodEnd`). */
  nextBillingCycle: string | null;
  createdAt: string;
}
