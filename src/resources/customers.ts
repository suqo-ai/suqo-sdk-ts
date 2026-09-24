import type { HttpClient } from "../http/HttpClient.js";
import { bridgeAutoPaging, deserializePage, toPageQuery, type Page, type PageParams } from "../pagination.js";
import type { CreateCustomerParams, Customer, UpdateCustomerParams } from "../models/index.js";
import { SuqoConfigError } from "../errors/SuqoError.js";

/** `GET /api/v1/customers/` — no trailing slash here; `HttpClient`/`buildUrl` guarantees it (Ticket 2). */
const CUSTOMERS_PATH = "/api/v1/customers";

/**
 * The wire shape `openapi.yaml`'s `Customer` schema actually sends — snake_case. Uses `buyer_*`
 * prefixes, not the `client.*` nesting Subscriptions uses — carried through as its own convention,
 * not forced into the customer/client boundary's shape (that boundary is only about the
 * Subscriptions payload's embedded buyer, a genuinely different concept from this resource's own
 * record).
 *
 * `id` corrected to `string` and `address` added (Bug #42, found in review against the live
 * sandbox) — both were wrong in the version originally "confirmed live 2026-08-18": that
 * confirmation never actually matched what the API returns, it just went unnoticed until now.
 */
interface WireCustomer {
  id: string;
  // Optional, not just nullable, on all four of these (found in review, closing the class #42's
  // address fix opened): openapi.yaml's Customer schema only requires `id`/`created_at` — none of
  // these four are in `required`, and src/generated/schema.ts already reflects that (`?:` on all
  // four). This hand-written interface originally declared `address` the same required-but-wrong
  // way it still declared these three, so an entirely omitted key (spec-legal for any of them)
  // produced `undefined` here, flowing straight into a `Customer` type that promises `string |
  // null`, never `undefined`. Same class of bug as #42 itself: a declared type the wire never
  // actually promised.
  buyer_phone?: string | null;
  buyer_email?: string | null;
  full_name?: string | null;
  address?: string | null;
  created_at: string;
}

/** Exported for direct unit testing — not part of the SDK's public surface. */
export function deserializeCustomer(wire: WireCustomer): Customer {
  return {
    id: wire.id,
    // `?? null` on all four nullable fields (not a direct pass-through, found in review): catches
    // both an explicit `null` and an entirely omitted key — see the WireCustomer comment above.
    buyerPhone: wire.buyer_phone ?? null,
    buyerEmail: wire.buyer_email ?? null,
    fullName: wire.full_name ?? null,
    address: wire.address ?? null,
    createdAt: wire.created_at,
  };
}

/**
 * `CreateCustomerParams`/`UpdateCustomerParams` (SDK) → the wire's write shape. Only keys the
 * caller actually set are sent: on `update()` an omitted field must stay untouched server-side,
 * while `""` is a deliberate clear — so `undefined` is dropped and `""` is passed through as-is.
 */
function serializeCustomerWrite(params: CreateCustomerParams | UpdateCustomerParams): Record<string, unknown> {
  const wire: Record<string, unknown> = {};
  if ("phone" in params && params.phone !== undefined) wire.phone = params.phone;
  if (params.fullName !== undefined) wire.full_name = params.fullName;
  if (params.email !== undefined) wire.email = params.email;
  if (params.address !== undefined) wire.address = params.address;
  return wire;
}

/**
 * `client.customers` (SDK-SPEC.md §5, §6; `openapi.yaml` `listCustomers`/`retrieveCustomer`/
 * `createCustomer`/`updateCustomer`). No delete exists on this resource.
 */
export class CustomersResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Lists the authenticated seller's customers. Paginated (SDK-SPEC.md §6). */
  async list(params?: PageParams): Promise<Page<Customer>> {
    const wire = await this.#http.request<Page<WireCustomer>>({
      method: "GET",
      path: CUSTOMERS_PATH,
      query: toPageQuery(params),
    });
    return deserializePage(wire, deserializeCustomer);
  }

  /**
   * Auto-iterates every customer across every page, following `next` until it's `null`
   * (SDK-SPEC.md §6). Manual `list({ page, pageSize })` remains available independently — this is
   * additive, not a replacement.
   */
  autoPaging(params?: PageParams): AsyncIterableIterator<Customer> {
    return bridgeAutoPaging(() => this.list(params), async (nextUrl) => {
      const wire = await this.#http.request<Page<WireCustomer>>({ method: "GET", path: nextUrl });
      return deserializePage(wire, deserializeCustomer);
    });
  }

  /**
   * Retrieves a single customer by id — an opaque prefixed string (e.g. `"cus_1ce18d624"`), like
   * `pbp_...` on billing periods, not an integer and not a UUID (Bug #42 corrected the previously
   * wrong `number` type/doc claim here).
   */
  async retrieve(id: string): Promise<Customer> {
    // Found in review of the string-id change (#42): an empty id isn't a path-corruption case
    // like cancel()/resume()'s "" (which builds a genuinely invalid, loudly-404ing double-slash
    // path) — `${CUSTOMERS_PATH}/${encodeURIComponent("")}` collapses to exactly `list()`'s own
    // URL, so the request silently succeeds against the wrong endpoint. Its 200 pagination
    // envelope then feeds straight into deserializeCustomer, which reads wire.id/wire.buyer_email/
    // etc. off an object with none of them and returns a Customer of all-undefined fields with no
    // error at all — surfacing as a confusing null-pointer far from this call, not here. `id:
    // string` makes an empty id ordinary reachable input (`retrieve(req.params.id)`,
    // `retrieve(user.customerId ?? "")`) in a way `id: number` never could (no number stringifies
    // to "").
    if (!id) {
      throw new SuqoConfigError("customers.retrieve() requires a non-empty id");
    }

    // encodeURIComponent — same path-corruption risk as subscriptions.cancel()/resume(), now that
    // id is a real caller-supplied string rather than a number.
    const wire = await this.#http.request<WireCustomer>({
      method: "GET",
      path: `${CUSTOMERS_PATH}/${encodeURIComponent(id)}`,
    });
    return deserializeCustomer(wire);
  }

  /**
   * Records a customer on the seller's account without opening a subscription. `phone` identifies
   * the buyer; the name, email and address are the seller's own copy and aren't shared with other
   * sellers.
   *
   * A phone the seller already holds updates that existing customer instead of creating a second
   * one (the API answers `200` rather than `201`; both resolve to the `Customer` here). That makes
   * this call safe for the caller to retry — but, like every write, the SDK never retries it
   * automatically (SDK-SPEC.md §8, §12).
   */
  async create(params: CreateCustomerParams): Promise<Customer> {
    const wire = await this.#http.request<WireCustomer, unknown>({
      method: "POST",
      path: CUSTOMERS_PATH,
      body: serializeCustomerWrite(params),
    });
    return deserializeCustomer(wire);
  }

  /**
   * Updates the seller's copy of a customer's name, email or address. Send only the fields you're
   * changing; `""` clears a field. The phone can't be changed.
   *
   * Not auto-retryable — writes never retry until idempotency ships (SDK-SPEC.md §8, §12).
   */
  async update(id: string, params: UpdateCustomerParams): Promise<Customer> {
    // Same guard as retrieve(): an empty id would collapse onto the collection URL and send the
    // PATCH to the wrong endpoint rather than failing on the intended one.
    if (!id) {
      throw new SuqoConfigError("customers.update() requires a non-empty id");
    }

    const wire = await this.#http.request<WireCustomer, unknown>({
      method: "PATCH",
      path: `${CUSTOMERS_PATH}/${encodeURIComponent(id)}`,
      body: serializeCustomerWrite(params),
    });
    return deserializeCustomer(wire);
  }
}
