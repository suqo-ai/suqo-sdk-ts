/**
 * The `products` resource's model types (`specs/openapi.yaml` `Product`/`Plan`/`BillingPeriod` —
 * SDK-SPEC.md §5). Field names are camelCase per R3; nothing here is renamed from the wire (R5) —
 * these three schemas aren't in the naming map's rename register.
 *
 * @packageDocumentation
 */

/** VAT configuration for a {@link Product}, if any. */
export interface ProductVat {
  isVatActive: boolean;
  vatType: string;
  /** Decimal string (e.g. `"13.00"`). Never coerced to a number — SDK-SPEC.md §5. */
  vatPercentage: string;
}

/** A seller's product, as returned by `products.list()` (`openapi.yaml` `Product`). */
export interface Product {
  productId: string;
  name: string;
  description: string;
  type: string;
  isActive: boolean;
  termsAndConditions: string;
  featuresAndBenefits: string;
  vat: ProductVat | null;
  /** Ordered images; blank images already excluded server-side. */
  productImage: string[];
  plan: Plan[];
  /** Count of active subscribers. Sent as a string on the wire — kept as one, never coerced (SDK-SPEC.md §5). */
  totalSubscribers: string;
  createdAt: string;
  updatedAt: string;
}

/** A billing plan on a {@link Product} (`openapi.yaml` `Plan`). */
export interface Plan {
  planId: string;
  planName: string;
  description: string;
  billingPeriods: BillingPeriod[];
}

/**
 * One billable period on a {@link Plan} (`openapi.yaml` `BillingPeriod`). Its `pbpId` is what
 * `subscriptions.create()` expects as `pbpId` (SDK-SPEC.md §5).
 */
export interface BillingPeriod {
  /** Public id — pass this to `subscriptions.create({ pbpId, ... })`. */
  pbpId: string;
  intervalType: string;
  intervalCount: number;
  label: string;
  /** Decimal string. Never coerced to a number — SDK-SPEC.md §5. */
  price: string;
  currency: string;
  isCurrent: boolean;
  isLimited: boolean;
  isArchived: boolean;
  /** Wire schema is an empty item type (`items: {}`) — shape not yet specified by the API. */
  offers: unknown[];
}
