import type { HttpClient } from "../http/HttpClient.js";
import { bridgeAutoPaging, deserializePage, toPageQuery, type Page, type PageParams } from "../pagination.js";
import type { Customer } from "../models/index.js";

/** `GET /api/v1/customers/` — no trailing slash here; `HttpClient`/`buildUrl` guarantees it (Ticket 2). */
const CUSTOMERS_PATH = "/api/v1/customers";

/**
 * The wire shape `openapi.yaml`'s `Customer` schema actually sends — snake_case, confirmed live
 * 2026-08-18 (re-verified live against BE Swagger + `suqo.ai/docs/api/customers`, both agree).
 * Uses `buyer_*` prefixes, not the `client.*` nesting Subscriptions uses — carried through as its
 * own convention, not forced into the customer/client boundary's shape (that boundary is only
 * about the Subscriptions payload's embedded buyer, a genuinely different concept from this
 * resource's own record).
 */
interface WireCustomer {
  id: number;
  buyer_phone: string | null;
  buyer_email: string | null;
  full_name: string | null;
  created_at: string;
}

/** Exported for direct unit testing — not part of the SDK's public surface. */
export function deserializeCustomer(wire: WireCustomer): Customer {
  return {
    id: wire.id,
    buyerPhone: wire.buyer_phone,
    buyerEmail: wire.buyer_email,
    fullName: wire.full_name,
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
   * Retrieves a single customer by id. Unlike every other resource in this API, `id` is an
   * **integer**, not a UUID (SDK-SPEC.md §5 naming note; `openapi.yaml` `Customer.id`).
   */
  async retrieve(id: number): Promise<Customer> {
    const wire = await this.#http.request<WireCustomer>({
      method: "GET",
      path: `${CUSTOMERS_PATH}/${id}`,
    });
    return deserializeCustomer(wire);
  }
}
