import type { SubscriptionStatus } from "./Subscription.js";

/**
 * The three confirmed webhook event payload shapes (docs/implementation-plan.md Ticket 0 item 2,
 * resolved 2026-08-17; re-verified live against `suqo.ai/docs/api/webhooks` on 2026-08-25).
 *
 * Deliberately **snake_case**, unlike every other model in this SDK — `webhooks.verify()`
 * (Ticket 5) only checks the signature and returns a `boolean`; it never parses the body itself
 * (SDK-SPEC.md §9). A caller runs `JSON.parse(rawBody)` on their own, and that call genuinely
 * produces snake_case keys, since nothing in this SDK converts them. Typing these as camelCase
 * would describe a shape that doesn't exist at runtime — the same class of bug already found and
 * fixed twice in the resource layer (Ticket 4), just avoided here from the start.
 *
 * @packageDocumentation
 */

/**
 * Fields shared by every *subscription-related* webhook event (2026-08-25).
 * Deliberately named for **subscription** events specifically, not a generic `BaseWebhookEvent` —
 * `subscription_id` is common to these three because all three happen to be about a subscription,
 * not because every webhook event SUQO will ever send is guaranteed to carry one. A future event
 * about a different resource (e.g. a customer- or payout-level event) would need its own base, not
 * be forced through this one. SDK Naming Map v1.1 has no coverage of this at all — same gap as the
 * event fields themselves.
 */
interface SubscriptionWebhookEventBase {
  subscription_id: string;
}

/** A successful checkout. `status` is always `"succeeded"` on this event — never anything else. */
export interface CheckoutSucceededEvent extends SubscriptionWebhookEventBase {
  event: "checkout.succeeded";
  /** Decimal string. Never coerced to a number — SDK-SPEC.md §9. */
  amount: string;
  status: "succeeded";
}

/**
 * A failed checkout. `status` is always `"failed"` — the platform deliberately omits the specific
 * failure reason from this payload.
 */
export interface CheckoutFailedEvent extends SubscriptionWebhookEventBase {
  event: "checkout.failed";
  /** Decimal string. Never coerced to a number — SDK-SPEC.md §9. */
  amount: string;
  status: "failed";
}

/**
 * A subscription's status changed. No `amount` field — this is a status transition, not a
 * payment. Named `subscription.status_changed` on the wire (underscore, past tense) — SDK-SPEC.md
 * §9's prose still says `subscription.status.change`; that's the doc that's stale, not this type
 * (docs/implementation-plan.md Ticket 0 item 2).
 */
export interface SubscriptionStatusChangedEvent extends SubscriptionWebhookEventBase {
  event: "subscription.status_changed";
  previous_status: SubscriptionStatus;
  current_status: SubscriptionStatus;
  /** ISO 8601 timestamp. */
  changed_at: string;
}

/**
 * Any confirmed webhook event. Not exhaustive of everything SUQO might ever send — narrow on
 * `event` before trusting the rest of the shape, the same way you'd handle any tagged union from
 * an external source.
 */
export type WebhookEvent = CheckoutSucceededEvent | CheckoutFailedEvent | SubscriptionStatusChangedEvent;

/**
 * Every event name the SDK currently knows the shape of — derived from {@link WebhookEvent}, not
 * hand-duplicated, so it can never drift out of sync with the union above. Same standalone
 * flat-union-of-event-names pattern as other SDKs' `WebhookEventType`; just three values today
 * since that's everything SUQO's API documents (`specs/openapi.yaml`), not dozens.
 */
export type WebhookEventType = WebhookEvent["event"];
// → "checkout.succeeded" | "checkout.failed" | "subscription.status_changed"
