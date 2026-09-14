import type { HttpClient } from "../http/HttpClient.js";
import { bridgeAutoPaging, deserializePage, toPageQuery, type Page, type PageParams } from "../pagination.js";
import type { Customer } from "../models/index.js";
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
  buyer_phone: string | null;
  buyer_email: string | null;
  full_name: string | null;
  // Optional, not just nullable (found in review): openapi.yaml's Customer schema doesn't list
  // `address` in `required`, and src/generated/schema.ts already reflects that (`address?:`) —
  // this hand-written interface didn't, so an entirely omitted `address` key (spec-legal) produced
  // `undefined` here, which then flowed straight into a `Customer.address: string | null` that
  // promises it's never `undefined`. Same class of bug as #42 itself: a declared type the wire
  // never actually promised.
  address?: string | null;
  created_at: string;
}

/** Exported for direct unit testing — not part of the SDK's public surface. */
export function deserializeCustomer(wire: WireCustomer): Customer {
  return {
    id: wire.id,
    buyerPhone: wire.buyer_phone,
    buyerEmail: wire.buyer_email,
    fullName: wire.full_name,
    // `?? null` (not a direct pass-through, found in review): catches both an explicit `null` and
    // an entirely omitted `address` key — see the WireCustomer.address comment above.
    address: wire.address ?? null,
    createdAt: wire.created_at,
  };
}

/**
 * `client.customers` (SDK-SPEC.md §5, §6; `openapi.yaml` `listCustomers`/`retrieveCustomer`).
 * Read-only — no create/update/delete exists on this resource.
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
}
