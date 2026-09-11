import type { HttpClient } from "../http/HttpClient.js";
import { bridgeAutoPaging, deserializePage, toPageQuery, type Page, type PageParams } from "../pagination.js";
import type { Customer } from "../models/index.js";

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
  address: string | null;
  created_at: string;
}

/** Exported for direct unit testing — not part of the SDK's public surface. */
export function deserializeCustomer(wire: WireCustomer): Customer {
  return {
    id: wire.id,
    buyerPhone: wire.buyer_phone,
    buyerEmail: wire.buyer_email,
    fullName: wire.full_name,
    address: wire.address,
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
    // encodeURIComponent — same path-corruption risk as subscriptions.cancel()/resume(), now that
    // id is a real caller-supplied string rather than a number.
    const wire = await this.#http.request<WireCustomer>({
      method: "GET",
      path: `${CUSTOMERS_PATH}/${encodeURIComponent(id)}`,
    });
    return deserializeCustomer(wire);
  }
}
