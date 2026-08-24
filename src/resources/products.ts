import type { HttpClient } from "../http/HttpClient.js";
import { bridgeAutoPaging, toPageQuery, type Page, type PageParams } from "../pagination.js";
import type { Product } from "../models/index.js";

/** `GET /api/v1/products/` — no trailing slash here; `HttpClient`/`buildUrl` guarantees it (Ticket 2). */
const PRODUCTS_PATH = "/api/v1/products";

/**
 * `client.products` (SDK-SPEC.md §5, §6; `openapi.yaml` `listProducts`). The only resource that
 * works before KYC verification — no `KycRequiredError` case to handle here.
 */
export class ProductsResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Lists the authenticated seller's active products. Paginated (SDK-SPEC.md §6). */
  async list(params?: PageParams): Promise<Page<Product>> {
    return this.#http.request<Page<Product>>({
      method: "GET",
      path: PRODUCTS_PATH,
      query: toPageQuery(params),
    });
  }

  /**
   * Auto-iterates every product across every page, following `next` until it's `null`
   * (SDK-SPEC.md §6). Manual `list({ page, pageSize })` remains available independently — this is
   * additive, not a replacement.
   */
  autoPaging(params?: PageParams): AsyncIterableIterator<Product> {
    return bridgeAutoPaging(this.list(params), (nextUrl) =>
      this.#http.request<Page<Product>>({ method: "GET", path: nextUrl }),
    );
  }
}
