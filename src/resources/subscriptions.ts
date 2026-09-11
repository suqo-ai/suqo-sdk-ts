import type { HttpClient } from "../http/HttpClient.js";
import { bridgeAutoPaging, toPageQuery, type PageParams, type SubscriptionPage } from "../pagination.js";
import { SubscriptionStatus, type Subscription, type SubscriptionProduct } from "../models/Subscription.js";
import type {
  CreateSubscriptionParams,
  CreateSubscriptionResponse,
  MessageResponse,
  UpdateBillingCycleParams,
} from "../models/index.js";
import { deserializeSubscriptionCustomer, serializeCustomerInput } from "./serialization.js";

/** No trailing slash here; `HttpClient`/`buildUrl` guarantees it (Ticket 2). */
const SUBSCRIPTIONS_PATH = "/api/v1/subscriptions";

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
 * `createSubscription`/`cancelSubscription`/`updateBillingCycle`/`resumeSubscription`).
 *
 * `retrieve(id)` is deliberately **not** implemented — still blocked on a real sample response
 * from backend (docs/implementation-plan.md Ticket 4). Every other operation here is confirmed.
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
   * Creates a subscription in `pending_checkout` state and returns a checkout URL for the buyer
   * to pay (SDK-SPEC.md §5). Redirect the buyer to `checkoutUrl`; the return is **not** proof of
   * payment — learn the real outcome via the `checkout.succeeded`/`checkout.failed` webhooks.
   *
   * Reuse behavior: an inactive/expired subscription for the same buyer + product + billing
   * period is reactivated rather than duplicated; only a currently `active` one triggers the
   * duplicate-subscription `ValidationError`.
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
   * moves to `pending_cancellation`; the subscription stays active until the period ends.
   *
   * Not auto-retryable — writes never retry until idempotency ships (SDK-SPEC.md §8, §12).
   */
  async cancel(id: string): Promise<MessageResponse> {
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
   * Resumes a subscription. Confirmed public with backend (2026-08-18); the response shape
   * follows Swagger's `{ message }` example but — unlike Customers — isn't independently
   * confirmed, so treat it as likely-correct-but-unverified (docs/implementation-plan.md Ticket 4).
   *
   * Not auto-retryable — writes never retry until idempotency ships (SDK-SPEC.md §8, §12).
   */
  async resume(id: string): Promise<MessageResponse> {
    // encodeURIComponent, found in review: same path-corruption risk as cancel() above.
    return this.#http.request<MessageResponse>({
      method: "POST",
      path: `${SUBSCRIPTIONS_PATH}/${encodeURIComponent(id)}/resume`,
    });
  }
}
