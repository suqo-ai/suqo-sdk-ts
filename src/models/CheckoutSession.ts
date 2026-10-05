import type { IntervalType, VatType } from "./wireEnums.js";

/**
 * The `checkoutSessions` resource's model types (`specs/openapi.yaml` `CreateCheckoutSessionRequest`
 * / `CheckoutSessionResponse` / `CheckoutSession` — SDK-SPEC.md §5). Names per SDK Naming Map §5:
 * the request body is `*Params`, nested write shapes are `*Input` (as {@link
 * import("./Customer.js").CustomerInput}), and the response shared by `checkoutSessions.create()`
 * and `subscriptions.renew()` is {@link CheckoutSessionResponse}.
 *
 * @packageDocumentation
 */

/**
 * A catalogue item: charges an existing billing period at its catalogue price. The plan sets the
 * price and cadence, so none of the partner-priced fields may be sent alongside `pbpId` — the
 * `never` fields make that a compile error rather than an API 400.
 */
export interface CatalogueItemInput {
  /** Billing period to charge — `products.list()`'s `plan[].billingPeriods[].pbpId`. */
  pbpId: string;
  name?: never;
  amount?: never;
  intervalType?: never;
  intervalCount?: never;
}

/** A partner-priced item: charges a price you set, with no billing period behind it. */
export interface PartnerPricedItemInput {
  /** What the buyer sees on the checkout page. */
  name: string;
  /**
   * The exact price to charge, as a decimal string (e.g. `"2500.00"`). Must already include any
   * discount — SUQO charges this number as sent. Never a `number` (SDK-SPEC.md §5).
   */
  amount: string;
  /** `day`, `week`, `month`, `year` or `one_time`. */
  intervalType: IntervalType;
  /**
   * Cadence multiplier — `1` with `month` bills monthly. 1–1095 for `day`, 1–156 for `week`, 1–36
   * for `month`, 1–3 for `year`; must be `0` for `one_time`.
   */
  intervalCount: number;
  pbpId?: never;
}

/** One item in {@link CreateCheckoutSessionParams.items}: either a catalogue or a partner-priced item, never a mix. */
export type CheckoutItemInput = CatalogueItemInput | PartnerPricedItemInput;

/** What `checkoutSessions.create(params)` accepts (`openapi.yaml` `CreateCheckoutSessionRequest`, renamed). */
export interface CreateCheckoutSessionParams {
  /**
   * One to ten items. If two resolve to the same product (e.g. two billing periods of one
   * product), only the last is kept — silently, with no error.
   */
  items: CheckoutItemInput[];
  /** Where the buyer lands after paying. Not proof of payment — learn the outcome from the `checkout.*` webhooks. */
  returnUrl: string;
  /**
   * A `cus_…` already on your account (`customers.create()`). The buyer then goes straight to
   * payment and can't edit their details there. Omit it to have the buyer enter their full name,
   * email, phone and address at checkout.
   */
  customerId?: string;
}

/**
 * The checkout link returned by `checkoutSessions.create()` and `subscriptions.renew()`
 * (`openapi.yaml` `CheckoutSessionResponse`).
 */
export interface CheckoutSessionResponse {
  /** `cks_…` — also the `session_id` on the `checkout.*` webhooks. */
  publicId: string;
  /** When `checkoutUrl` stops working, about 30 minutes out. Kept as sent (may carry a `+05:45` offset). */
  expiresAt: string;
  /** Send the buyer here. Not proof of payment — wait for `checkout.succeeded`. */
  checkoutUrl: string;
}

/** One line of a {@link CheckoutSession} (`openapi.yaml` `CheckoutLineItem`). */
export interface CheckoutLineItem {
  /** The product name for a catalogue item; the name you sent for a partner-priced one. */
  name: string;
  /** Decimal string. Never coerced to a number — SDK-SPEC.md §5. */
  amount: string;
  /** The billing period for a catalogue item; `null` for a partner-priced one. */
  pbpId: string | null;
  currency: string;
  vatType: VatType | null;
  /** Decimal string, or `null`. */
  vatPercentage: string | null;
  /** Decimal string, or `null`. */
  discountAmount: string | null;
  intervalType: IntervalType;
  intervalCount: number;
  /** Human-readable cadence, e.g. `"Monthly"` or `"Every 2 months"`. */
  displayLabel: string;
  currentPeriodEnd: string | null;
  /** `YYYY-MM-DD` — how far a payment now would extend the subscription. */
  extendsTo: string | null;
  /** `YYYY-MM-DD`. */
  nextPaymentDue: string | null;
  /** Catalogue items only. */
  imageUrls?: string[];
  /** Partner-priced items only. */
  planName?: string | null;
}

/** The seller shown on a {@link CheckoutSession} (`openapi.yaml` `CheckoutSeller`). */
export interface CheckoutSeller {
  id: string;
  /** The seller's own contact number — personal data; don't log it. */
  phone: string;
  businessLogo: string | null;
  businessName: string;
}

/**
 * An open checkout session, as returned by `checkoutSessions.retrieve()` (`openapi.yaml`
 * `CheckoutSession`). Only an open session can be read: once paid or expired, retrieving it throws
 * `NotFoundError`.
 */
export interface CheckoutSession {
  publicId: string;
  lineItems: CheckoutLineItem[];
  /** The `cus_…` the session was opened with, or `null` if the buyer enters their own details. */
  customerId: string | null;
  sellerDetails: CheckoutSeller;
  returnUrl: string;
  /** Kept as sent (may carry a `+05:45` offset). */
  expiresAt: string;
  completedAt: string | null;
  isExpired: boolean;
}
