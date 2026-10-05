/**
 * Wire enums shared by several models. Each is the known values **or** any other string — the
 * same "loose autocomplete" idiom as {@link import("./Subscription.js").SubscriptionStatus}: a
 * value the API adds later still decodes instead of breaking deployed code (SDK Naming Map §9,
 * "decoders must round-trip an unknown value").
 *
 * Internal aliases only — not exported from the package barrel, because the Naming Map registers
 * no public name for them. Fields that use them show the expanded union to callers.
 *
 * @packageDocumentation
 */

// eslint-disable-next-line @typescript-eslint/ban-types
type Loose = string & {};

/** Billing cadence. `one_time` is a single purchase, not a cadence (no next billing date). */
export type IntervalType = "day" | "week" | "month" | "year" | "one_time" | Loose;

/** Whether a VAT percentage is already included in a price or added on top. */
export type VatType = "inclusive" | "exclusive" | Loose;

/** A product's pricing model. */
export type ProductType = "simple" | "tiered" | Loose;
