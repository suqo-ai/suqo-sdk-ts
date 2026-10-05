import type { HttpClient } from "../http/HttpClient.js";
import type {
  CheckoutItemInput,
  CheckoutLineItem,
  CheckoutSession,
  CheckoutSessionResponse,
  CreateCheckoutSessionParams,
} from "../models/index.js";
import { assertPathId } from "../utils/index.js";
import { deserializeCheckoutSessionResponse, type WireCheckoutSessionResponse } from "./serialization.js";

/** No trailing slash here; `HttpClient`/`buildUrl` guarantees it (Ticket 2). */
const CHECKOUT_SESSIONS_PATH = "/api/v1/checkout-sessions";

/**
 * `openapi.yaml`'s `CheckoutLineItem`, confirmed against a captured `GET` response (2026-10-05).
 * Keys absent from a captured item are optional here, and the deserializer turns them into `null`.
 */
interface WireCheckoutLineItem {
  name: string;
  amount: string;
  pbp_id?: string | null;
  currency: string;
  vat_type?: string | null;
  vat_percentage?: string | null;
  discount_amount?: string | null;
  interval_type: string;
  interval_count: number;
  display_label: string;
  current_period_end?: string | null;
  extends_to?: string | null;
  next_payment_due?: string | null;
  /** Catalogue items only. */
  image_urls?: string[];
  /** Partner-priced items only. */
  plan_name?: string | null;
}

interface WireCheckoutSeller {
  id: string;
  phone: string;
  business_logo?: string | null;
  business_name: string;
}

interface WireCheckoutSession {
  public_id: string;
  line_items?: WireCheckoutLineItem[];
  customer_id?: string | null;
  seller_details: WireCheckoutSeller;
  return_url: string;
  expires_at: string;
  completed_at?: string | null;
  is_expired: boolean;
}

function deserializeLineItem(wire: WireCheckoutLineItem): CheckoutLineItem {
  return {
    name: wire.name,
    amount: wire.amount,
    pbpId: wire.pbp_id ?? null,
    currency: wire.currency,
    vatType: wire.vat_type ?? null,
    vatPercentage: wire.vat_percentage ?? null,
    discountAmount: wire.discount_amount ?? null,
    intervalType: wire.interval_type,
    intervalCount: wire.interval_count,
    displayLabel: wire.display_label,
    currentPeriodEnd: wire.current_period_end ?? null,
    extendsTo: wire.extends_to ?? null,
    nextPaymentDue: wire.next_payment_due ?? null,
    // Each kind carries one of these and not the other, so they stay absent rather than null.
    ...(wire.image_urls !== undefined ? { imageUrls: wire.image_urls } : {}),
    ...(wire.plan_name !== undefined ? { planName: wire.plan_name } : {}),
  };
}

/** Exported for direct unit testing — not part of the SDK's public surface. */
export function deserializeCheckoutSession(wire: WireCheckoutSession): CheckoutSession {
  return {
    publicId: wire.public_id,
    lineItems: (wire.line_items ?? []).map(deserializeLineItem),
    customerId: wire.customer_id ?? null,
    sellerDetails: {
      id: wire.seller_details.id,
      phone: wire.seller_details.phone,
      businessLogo: wire.seller_details.business_logo ?? null,
      businessName: wire.seller_details.business_name,
    },
    returnUrl: wire.return_url,
    expiresAt: wire.expires_at,
    completedAt: wire.completed_at ?? null,
    isExpired: wire.is_expired,
  };
}

/**
 * A {@link CheckoutItemInput} (SDK) → the wire's item shape. Only one of the two forms is sent:
 * catalogue (`pbp_id` alone) or partner-priced (`name`/`amount`/`interval_type`/`interval_count`).
 */
function serializeItem(item: CheckoutItemInput): Record<string, unknown> {
  if (item.pbpId !== undefined) return { pbp_id: item.pbpId };
  return {
    name: item.name,
    amount: item.amount,
    interval_type: item.intervalType,
    interval_count: item.intervalCount,
  };
}

/**
 * `client.checkoutSessions` (SDK-SPEC.md §5; `openapi.yaml` `createCheckoutSession`/
 * `retrieveCheckoutSession`). The recommended way to collect payment: up to ten items in one
 * checkout, replacing the legacy `subscriptions.create()`.
 */
export class CheckoutSessionsResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Opens a checkout session for one to ten items and returns a URL for the buyer to pay. Prices
   * are snapshotted now, so a plan edited later can't change what the buyer was shown. Redirect
   * the buyer to `checkoutUrl`; the return to `returnUrl` is **not** proof of payment — learn the
   * outcome from `checkout.succeeded`/`checkout.failed`, matched on `publicId` (`session_id`).
   *
   * The API's one rate-limited endpoint: 20 sessions a minute per account. Past that it throws
   * `RateLimitError` with `retryAfter` set. Never retried automatically — writes don't retry until
   * idempotency ships (SDK-SPEC.md §8, §12) — so open a session when the buyer commits to paying,
   * not on page load.
   */
  async create(params: CreateCheckoutSessionParams): Promise<CheckoutSessionResponse> {
    const wire = await this.#http.request<WireCheckoutSessionResponse, unknown>({
      method: "POST",
      path: CHECKOUT_SESSIONS_PATH,
      body: {
        items: params.items.map(serializeItem),
        return_url: params.returnUrl,
        ...(params.customerId !== undefined ? { customer_id: params.customerId } : {}),
      },
    });
    return deserializeCheckoutSessionResponse(wire);
  }

  /**
   * Reads one of your own open sessions: its line items, customer, seller and expiry. Once paid,
   * expired, unknown or someone else's, it throws `NotFoundError`.
   */
  async retrieve(id: string): Promise<CheckoutSession> {
    assertPathId(id, "checkoutSessions.retrieve");
    const wire = await this.#http.request<WireCheckoutSession>({
      method: "GET",
      path: `${CHECKOUT_SESSIONS_PATH}/${encodeURIComponent(id)}`,
    });
    return deserializeCheckoutSession(wire);
  }
}
