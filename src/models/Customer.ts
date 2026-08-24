/**
 * Every customer-shaped type in the SDK (SDK Naming Map v1.1 §11 "Customer boundary", §12 rename
 * register). The wire field is `client` everywhere (`openapi.yaml`'s `ClientRead`/`ClientWrite`)
 * — it collides with the SDK's own client object in every target language, so the surface renames
 * it to `customer`, translated at the serializer boundary only. `rawBody` is never translated
 * (R1). Three distinct types come out of this, not one — the read shape, the write shape, and the
 * real `customers` resource's own full record are genuinely different shapes:
 *
 * - {@link SubscriptionCustomer} — read, embedded on a `Subscription` (was `ClientRead`).
 * - {@link CustomerInput} — write, passed to `subscriptions.create()` (was `ClientWrite`).
 * - {@link Customer} — the `customers` resource's own full record (was reserved; now live).
 *
 * @packageDocumentation
 */

/**
 * The nested `billing`/`shipping` sub-objects use different wire key prefixes on read vs. write
 * (`openapi.yaml` `ClientRead`/`ClientWrite`) — this isn't a naming inconsistency to fix, it's
 * what the backend actually sends/expects; the serialization boundary (Ticket 4 step 3) maps each
 * side to/from its own wire keys independently.
 */
export interface SubscriptionCustomerBilling {
  businessName?: string;
  email?: string;
  address?: string;
  panVat?: string;
}

export interface SubscriptionCustomerShipping {
  phone?: string;
  fullName?: string;
  email?: string;
  address?: string;
}

/**
 * The read shape embedded on a {@link import("./Subscription.js").Subscription}'s `customer`
 * field (`openapi.yaml` `ClientRead`, renamed). None of its fields are marked required on the
 * wire, so all are optional here rather than assumed present.
 */
export interface SubscriptionCustomer {
  phone?: string;
  fullName?: string;
  email?: string;
  address?: string;
  billing?: SubscriptionCustomerBilling | null;
  shipping?: SubscriptionCustomerShipping | null;
}

/** The write shape of `CustomerInput.billing`, if provided (`openapi.yaml` `ClientWrite.billing`). */
export interface CustomerInputBilling {
  businessName: string;
  email: string;
  address: string;
  /** 9 digits. */
  panVat?: string;
}

/** The write shape of `CustomerInput.shipping`, if provided (`openapi.yaml` `ClientWrite.shipping`). */
export interface CustomerInputShipping {
  phone: string;
  fullName: string;
  email: string;
  address?: string;
}

/**
 * What `subscriptions.create({ ..., customer })` accepts (`openapi.yaml` `ClientWrite`, renamed).
 * When `billing` is omitted, billing info is filled from the buyer's own profile server-side; on a
 * reused subscription (SDK-SPEC.md §5's reuse behavior), only the non-null fields overwrite.
 */
export interface CustomerInput {
  /** Buyer identity — matches or creates the buyer. */
  phone: string;
  fullName: string;
  email: string;
  address: string;
  billing?: CustomerInputBilling;
  shipping?: CustomerInputShipping;
}

/**
 * A seller's own customer record, as returned by `customers.list()`/`customers.retrieve()`
 * (`openapi.yaml` `Customer`, confirmed live 2026-08-18). Distinct from {@link SubscriptionCustomer}
 * and {@link CustomerInput} — see this file's module doc.
 *
 * Uses `buyer*`-prefixed field names, not the `client.*` nesting Subscriptions uses — a genuinely
 * different resource with its own confirmed convention, carried through as-is.
 */
export interface Customer {
  /** Integer, not a UUID — breaks from the UUID convention every other resource uses. */
  id: number;
  buyerPhone: string | null;
  buyerEmail: string | null;
  fullName: string | null;
  createdAt: string;
}
