/**
 * The `products` resource's model types (`specs/openapi.yaml` `Product`/`Plan`/`BillingPeriod` —
 * SDK-SPEC.md §5). Field names are camelCase per R3; nothing here is renamed from the wire (R5) —
 * these three schemas aren't in the naming map's rename register.
 *
 * @packageDocumentation
 */
import type { IntervalType, ProductType, VatType } from "./wireEnums.js";

/** VAT configuration for a {@link Product}, if any. */
export interface ProductVat {
  isVatActive: boolean;
  /** `null` when no VAT type is configured. */
  vatType: VatType | null;
  /** Decimal string (e.g. `"13.00"`), or `null` when none is configured. Never coerced to a number — SDK-SPEC.md §5. */
  vatPercentage: string | null;
}

/** One image on a {@link Product} (`openapi.yaml` `ProductImage`). */
export interface ProductImage {
  /** Absolute image URL. */
  image: string;
  /** Display position, lowest first. */
  imageOrder: number;
}

/** A seller's product, as returned by `products.list()` (`openapi.yaml` `Product`). */
export interface Product {
  productId: string;
  name: string;
  description: string | null;
  type: ProductType;
  isActive: boolean;
  termsAndConditions: string | null;
  featuresAndBenefits: string | null;
  vat: ProductVat | null;
  /**
   * Ordered images; blank images already excluded server-side. Each is an object, not a bare URL
   * string — the API has always sent `{ image, image_order }`.
   */
  productImage: ProductImage[];
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
  description: string | null;
  billingPeriods: BillingPeriod[];
}

/**
 * One billable period on a {@link Plan} (`openapi.yaml` `BillingPeriod`). Its `pbpId` is what
 * `subscriptions.create()` expects as `pbpId` (SDK-SPEC.md §5).
 */
export interface BillingPeriod {
  /** Public id — pass this to `subscriptions.create({ pbpId, ... })`. */
  pbpId: string;
  /**
   * Billing cadence. `one_time` means a single purchase: subscriptions opened on it can't be
   * cancelled, resumed or rescheduled, and are left out of `subscriptions.list()`'s counts.
   */
  intervalType: IntervalType;
  intervalCount: number;
  label: string;
  /** Decimal string. Never coerced to a number — SDK-SPEC.md §5. */
  price: string;
  currency: string;
  isCurrent: boolean;
  isLimited: boolean;
  isArchived: boolean;
  offers: Offer[];
}

/** A discount on a {@link BillingPeriod} (`openapi.yaml` `Offer`). */
export interface Offer {
  id: string;
  /**
   * Whole units of the billing period's currency (rupees, not paisa). Already applied to
   * {@link BillingPeriod.price} while the offer is active — don't subtract it again.
   */
  discountAmount: number;
  /** `YYYY-MM-DD`, or `null` for no start bound. */
  startsAt: string | null;
  /** `YYYY-MM-DD`, or `null` for no end bound. */
  validUntil: string | null;
  isActive: boolean;
}
