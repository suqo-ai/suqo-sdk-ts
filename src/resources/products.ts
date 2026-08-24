import type { HttpClient } from "../http/HttpClient.js";
import { bridgeAutoPaging, deserializePage, toPageQuery, type Page, type PageParams } from "../pagination.js";
import type { BillingPeriod, Plan, Product, ProductVat } from "../models/index.js";

/** `GET /api/v1/products/` — no trailing slash here; `HttpClient`/`buildUrl` guarantees it (Ticket 2). */
const PRODUCTS_PATH = "/api/v1/products";

/**
 * The wire shapes `openapi.yaml`'s `Product`/`Plan`/`BillingPeriod` schemas actually send —
 * snake_case, exactly as documented. `HttpClient.request()` doesn't transform response bodies at
 * all (SDK-SPEC.md §5's camelCase requirement is this file's job, not the transport layer's), so
 * every field below is deserialized explicitly rather than trusted via a type assertion alone.
 */
interface WireBillingPeriod {
  pbp_id: string;
  interval_type: string;
  interval_count: number;
  label: string;
  price: string;
  currency: string;
  is_current: boolean;
  is_limited: boolean;
  is_archived: boolean;
  offers: unknown[];
}

interface WirePlan {
  plan_id: string;
  plan_name: string;
  description: string;
  billing_periods: WireBillingPeriod[];
}

interface WireProductVat {
  is_vat_active: boolean;
  vat_type: string;
  vat_percentage: string;
}

interface WireProduct {
  product_id: string;
  name: string;
  description: string;
  type: string;
  is_active: boolean;
  terms_and_conditions: string;
  features_and_benefits: string;
  vat: WireProductVat | null;
  product_image: string[];
  plan: WirePlan[];
  total_subscribers: string;
  created_at: string;
  updated_at: string;
}

/** Exported for direct unit testing — not part of the SDK's public surface. */
export function deserializeBillingPeriod(wire: WireBillingPeriod): BillingPeriod {
  return {
    pbpId: wire.pbp_id,
    intervalType: wire.interval_type,
    intervalCount: wire.interval_count,
    label: wire.label,
    price: wire.price,
    currency: wire.currency,
    isCurrent: wire.is_current,
    isLimited: wire.is_limited,
    isArchived: wire.is_archived,
    offers: wire.offers,
  };
}

/** Exported for direct unit testing — not part of the SDK's public surface. */
export function deserializePlan(wire: WirePlan): Plan {
  return {
    planId: wire.plan_id,
    planName: wire.plan_name,
    description: wire.description,
    billingPeriods: wire.billing_periods.map(deserializeBillingPeriod),
  };
}

function deserializeProductVat(wire: WireProductVat): ProductVat {
  return {
    isVatActive: wire.is_vat_active,
    vatType: wire.vat_type,
    vatPercentage: wire.vat_percentage,
  };
}

/** Exported for direct unit testing — not part of the SDK's public surface. */
export function deserializeProduct(wire: WireProduct): Product {
  return {
    productId: wire.product_id,
    name: wire.name,
    description: wire.description,
    type: wire.type,
    isActive: wire.is_active,
    termsAndConditions: wire.terms_and_conditions,
    featuresAndBenefits: wire.features_and_benefits,
    vat: wire.vat === null ? null : deserializeProductVat(wire.vat),
    productImage: wire.product_image,
    plan: wire.plan.map(deserializePlan),
    totalSubscribers: wire.total_subscribers,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  };
}

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
    const wire = await this.#http.request<Page<WireProduct>>({
      method: "GET",
      path: PRODUCTS_PATH,
      query: toPageQuery(params),
    });
    return deserializePage(wire, deserializeProduct);
  }

  /**
   * Auto-iterates every product across every page, following `next` until it's `null`
   * (SDK-SPEC.md §6). Manual `list({ page, pageSize })` remains available independently — this is
   * additive, not a replacement.
   */
  autoPaging(params?: PageParams): AsyncIterableIterator<Product> {
    return bridgeAutoPaging(() => this.list(params), async (nextUrl) => {
      const wire = await this.#http.request<Page<WireProduct>>({ method: "GET", path: nextUrl });
      return deserializePage(wire, deserializeProduct);
    });
  }
}
