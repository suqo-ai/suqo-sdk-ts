import type { HttpClient } from "../http/HttpClient.js";
import { bridgeAutoPaging, toPageQuery, type PageParams, type SubscriptionPage } from "../pagination.js";
import { SubscriptionStatus, type Subscription, type SubscriptionProduct } from "../models/Subscription.js";
import type {
  CheckoutSessionResponse,
  CreateSubscriptionParams,
  CreateSubscriptionResponse,
  MessageResponse,
  UpdateBillingCycleParams,
} from "../models/index.js";
import { assertPathId } from "../utils/index.js";
import {
  deserializeCheckoutSessionResponse,
  deserializeSubscriptionCustomer,
  serializeCustomerInput,
  type WireCheckoutSessionResponse,
} from "./serialization.js";

/** No trailing slash here; `HttpClient`/`buildUrl` guarantees it (Ticket 2). */
const SUBSCRIPTIONS_PATH = "/api/v1/subscriptions";
/** Singular `subscription`, unlike every other subscription route — that is the real wire path (R1). */
const RENEW_PATH = "/api/v1/subscription/renew";

/** The wire shape `openapi.yaml`'s `SubscriptionProduct` schema sends — a summary, not the full `Product`. */
interface WireSubscriptionProduct {
  product_id: string;
  name: string;
  plan_name: string;
  pbp_id: string;
  label: string;
  price: string;
  currency: string;
}

/**
 * The wire shape `openapi.yaml`'s `Subscription` schema sends. `client` is `unknown` here, not a
 * typed wire interface — {@link deserializeSubscriptionCustomer} (`./serialization.js`) already
 * accepts `unknown` and is best-effort about its shape, so there's no value duplicating that
 * typing here too.
 */
interface WireSubscription {
  subscription_id: string;
  status: string;
  is_active: boolean;
  client: unknown;
  // `WireSubscriptionProduct | null`, optional too (found in review): `openapi.yaml`'s
  // Subscription schema has no `required` list at all, the same gap already handled defensively
  // for Product's `vat` (`WireProductVat | null`, also optional) — so an omitted *or* explicitly
  // null `product` key is spec-legal here too, not just a hypothetical.
  product?: WireSubscriptionProduct | null;
  current_period_start: string | null;
  current_period_end: string | null;
  next_billing_cycle: string | null;
  created_at: string;
}

/** `openapi.yaml`'s `SubscriptionListEnvelope` — `PaginationEnvelope` plus the four extra counts. */
interface WireSubscriptionListEnvelope {
  count: number;
  next: string | null;
  previous: string | null;
  total_subscriptions: number;
  active_subscriptions: number;
  due_subscriptions: number;
  inactive_subscriptions: number;
  results: WireSubscription[];
}

/** `openapi.yaml`'s `CreateSubscriptionResponse` — no field renames, just casing (§06). */
interface WireCreateSubscriptionResponse {
  subscription_id: string;
  pbp_id: string;
  /** The wire guarantees this exact const value on every response (openapi.yaml `const: pending_checkout`). */
  status: typeof SubscriptionStatus.PendingCheckout;
  checkout_url: string;
  next_billing_cycle: string | null;
  created_at: string;
}

function deserializeSubscriptionProduct(wire: WireSubscriptionProduct): SubscriptionProduct {
  return {
    productId: wire.product_id,
    name: wire.name,
    planName: wire.plan_name,
    pbpId: wire.pbp_id,
    label: wire.label,
    price: wire.price,
    currency: wire.currency,
  };
}

/** Exported for direct unit testing — not part of the SDK's public surface. */
export function deserializeSubscription(wire: WireSubscription): Subscription {
  return {
    subscriptionId: wire.subscription_id,
    status: wire.status,
    isActive: wire.is_active,
    // Renamed from the wire's `client` — SDK Naming Map v1.1 §11 "Customer boundary".
    customer: deserializeSubscriptionCustomer(wire.client),
    // `== null` (not `=== null`) is deliberate — same reasoning as Product's `vat` field: catches
    // both an explicit `null` and an entirely omitted `product` key, either of which is spec-legal
    // since `openapi.yaml`'s Subscription schema has no `required` list. The old unconditional call
    // crashed on `deserializeSubscriptionProduct(undefined)` when the key was omitted (found in
    // review, reproduced).
    product: wire.product == null ? null : deserializeSubscriptionProduct(wire.product),
    currentPeriodStart: wire.current_period_start,
    currentPeriodEnd: wire.current_period_end,
    nextBillingCycle: wire.next_billing_cycle,
    createdAt: wire.created_at,
  };
}

/**
 * Exported for direct unit testing — not part of the SDK's public surface. Unlike
 * {@link import("../pagination.js").deserializePage}, this can't be the generic helper — the four
 * extra counts aren't part of `Page<T>`'s shape at all, so this envelope needs its own mapping.
 */
export function deserializeSubscriptionPage(wire: WireSubscriptionListEnvelope): SubscriptionPage<Subscription> {
  return {
    count: wire.count,
    next: wire.next,
    previous: wire.previous,
    totalSubscriptions: wire.total_subscriptions,
    activeSubscriptions: wire.active_subscriptions,
    dueSubscriptions: wire.due_subscriptions,
    inactiveSubscriptions: wire.inactive_subscriptions,
    results: wire.results.map(deserializeSubscription),
  };
}

/** Exported for direct unit testing — not part of the SDK's public surface. */
export function deserializeCreateSubscriptionResponse(
  wire: WireCreateSubscriptionResponse,
): CreateSubscriptionResponse {
  return {
    subscriptionId: wire.subscription_id,
    pbpId: wire.pbp_id,
    status: wire.status,
    checkoutUrl: wire.checkout_url,
    nextBillingCycle: wire.next_billing_cycle,
    createdAt: wire.created_at,
  };
}

/**
 * `client.subscriptions` (SDK-SPEC.md §5, §6, §7; `openapi.yaml` `listSubscriptions`/
 * `retrieveSubscription`/`createSubscription`/`cancelSubscription`/`updateBillingCycle`/
 * `resumeSubscription`/`renewSubscription`).
 *
 * One-time purchases (a billing period whose `intervalType` is `one_time`) appear in `list()` but
 * can't be cancelled, resumed, rescheduled or renewed — those calls throw `ValidationError`.
 */
export class SubscriptionsResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Lists the seller's subscriptions. Paginated, with four extra status counts alongside the
   * common envelope (SDK-SPEC.md §6).
   */
  async list(params?: PageParams): Promise<SubscriptionPage<Subscription>> {
    const wire = await this.#http.request<WireSubscriptionListEnvelope>({
      method: "GET",
      path: SUBSCRIPTIONS_PATH,
      query: toPageQuery(params),
    });
    return deserializeSubscriptionPage(wire);
  }

  /**
   * Auto-iterates every subscription across every page, following `next` until it's `null`
   * (SDK-SPEC.md §6). Manual `list({ page, pageSize })` remains available independently.
   */
  autoPaging(params?: PageParams): AsyncIterableIterator<Subscription> {
    return bridgeAutoPaging(() => this.list(params), async (nextUrl) => {
      const wire = await this.#http.request<WireSubscriptionListEnvelope>({ method: "GET", path: nextUrl });
      return deserializeSubscriptionPage(wire);
    });
  }

  /**
   * Retrieves one of your own subscriptions by id. Built from Swagger's schema; not yet checked
   * against a captured response.
   */
  async retrieve(id: string): Promise<Subscription> {
    // Same guard as customers.retrieve(): "" would collapse onto list()'s URL.
    assertPathId(id, "subscriptions.retrieve");
    const wire = await this.#http.request<WireSubscription>({
      method: "GET",
      path: `${SUBSCRIPTIONS_PATH}/${encodeURIComponent(id)}`,
    });
    return deserializeSubscription(wire);
  }

  /**
   * **Legacy** — prefer `checkoutSessions.create()`, which takes up to ten items in one payment
   * and doesn't need a full customer object. Still supported; existing integrations keep working.
   *
   * Creates a subscription in `pending_checkout` state and returns a checkout URL for the buyer
   * to pay (SDK-SPEC.md §5). Redirect the buyer to `checkoutUrl`; the return is **not** proof of
   * payment — learn the real outcome via the `checkout.succeeded`/`checkout.failed` webhooks.
   *
   * `customer.email` identifies the buyer. A buyer may hold only one live recurring subscription
   * per product: a second one on any billing period of the same product throws `ValidationError`.
   * To restart an inactive subscription, use `renew()` rather than creating a new one.
   *
   * Not auto-retryable — writes never retry until idempotency ships (SDK-SPEC.md §8, §12).
   */
  async create(params: CreateSubscriptionParams): Promise<CreateSubscriptionResponse> {
    const wire = await this.#http.request<WireCreateSubscriptionResponse, unknown>({
      method: "POST",
      path: SUBSCRIPTIONS_PATH,
      body: {
        pbp_id: params.pbpId,
        return_url: params.returnUrl,
        // Renamed from the wire's `client` — SDK Naming Map v1.1 §11 "Customer boundary".
        client: serializeCustomerInput(params.customer),
      },
    });
    return deserializeCreateSubscriptionResponse(wire);
  }

  /**
   * Schedules cancellation for the end of the current billing period — **not** immediate
   * (confirmed with backend 2026-08-17; immediate cancellation is a future capability). Status
   * moves to `pending_cancellation`; the subscription stays active until the period ends. Calling
   * it on a subscription already cancelled or pending cancellation returns it unchanged, so a
   * retry by the caller is safe.
   *
   * Not auto-retryable — writes never retry until idempotency ships (SDK-SPEC.md §8, §12).
   */
  async cancel(id: string): Promise<MessageResponse> {
    // "", "." and ".." would POST to a different route (e.g. ".." -> /api/v1/cancel/).
    assertPathId(id, "subscriptions.cancel");
    // encodeURIComponent, found in review: an unescaped id containing `?`/`#`/`/` would otherwise
    // be parsed as URL structure by buildUrl's `new URL(path, base)`, silently corrupting the
    // path instead of erroring — e.g. `?` truncates everything after it, swallowing `/cancel`
    // into the query string.
    return this.#http.request<MessageResponse>({
      method: "POST",
      path: `${SUBSCRIPTIONS_PATH}/${encodeURIComponent(id)}/cancel`,
    });
  }

  /**
   * Sets a subscription's next billing date. Collection-level action — the subscription id
   * travels in the body, not the path, mirroring the wire (SDK Naming Map v1.1 §04).
   *
   * Not auto-retryable — writes never retry until idempotency ships (SDK-SPEC.md §8, §12).
   */
  async updateBillingCycle(params: UpdateBillingCycleParams): Promise<MessageResponse> {
    return this.#http.request<MessageResponse, unknown>({
      method: "POST",
      path: `${SUBSCRIPTIONS_PATH}/update-billing-cycle`,
      body: {
        subscription_id: params.subscriptionId,
        next_billing_cycle: params.nextBillingCycle,
      },
    });
  }

  /**
   * Undoes a scheduled cancellation and returns the subscription to `active`. An already-active
   * subscription is returned unchanged. Once a subscription is `cancelled` there is nothing to
   * resume — use `renew()`.
   *
   * Not auto-retryable — writes never retry until idempotency ships (SDK-SPEC.md §8, §12).
   */
  async resume(id: string): Promise<MessageResponse> {
    assertPathId(id, "subscriptions.resume");
    // encodeURIComponent, found in review: same path-corruption risk as cancel() above.
    return this.#http.request<MessageResponse>({
      method: "POST",
      path: `${SUBSCRIPTIONS_PATH}/${encodeURIComponent(id)}/resume`,
    });
  }

  /**
   * Opens a checkout session for the next payment on one of your own subscriptions, reusing its
   * customer and billing period (or partner-priced item) rather than resubmitting them — how an
   * inactive subscription is restarted. Send the buyer to the returned `checkoutUrl`, and learn
   * the outcome from the `checkout.*` webhooks, matched on `publicId`.
   *
   * A cancelled or archived subscription, or a paid one-time purchase, can't be renewed: that
   * throws `ValidationError`. Not auto-retryable — writes never retry until idempotency ships
   * (SDK-SPEC.md §8, §12).
   */
  async renew(subscriptionId: string): Promise<CheckoutSessionResponse> {
    const wire = await this.#http.request<WireCheckoutSessionResponse, unknown>({
      method: "POST",
      path: RENEW_PATH,
      body: { subscription_id: subscriptionId },
    });
    return deserializeCheckoutSessionResponse(wire);
  }
}
