import { http, HttpResponse, type HttpHandler } from "msw";
import { setupServer } from "msw/node";

/**
 * The contract-test harness (Ticket 7; SDK-SPEC.md §15, addendum §11). Stands up a real HTTP mock
 * server via `msw` — the SDK's actual `HttpClient` makes real `fetch` calls against it, exactly as
 * it would against the real API, so these tests exercise the true request-building and
 * response-decoding path end to end, not a stubbed shortcut.
 *
 * Every handler here mirrors one operation from `specs/openapi.yaml` — same path, same method,
 * same response shape (snake_case, exactly as the real API sends it). If `openapi.yaml` changes
 * and these handlers don't get updated to match, the contract tests built on top of this harness
 * fail — that's the point of a *contract* test, as distinct from a unit test.
 *
 * @packageDocumentation
 */

const SANDBOX_BASE_URL = "https://test-be.suqo.ai";

/** One HTTP call as the mock server actually received it — what the contract tests assert against. */
export interface CapturedRequest {
  method: string;
  /** Full URL, including query string. */
  url: string;
  /** Lowercased header names, matching the `Headers` object's own normalization. */
  headers: Record<string, string>;
  /** Parsed JSON body, or `undefined` if the request had none. */
  body: unknown;
}

let capturedRequests: CapturedRequest[] = [];

/** Clears captured requests. Call in `beforeEach`/`afterEach` so tests don't leak into each other. */
export function resetCapturedRequests(): void {
  capturedRequests = [];
}

/** Every request captured since the last {@link resetCapturedRequests} call, in call order. */
export function getCapturedRequests(): readonly CapturedRequest[] {
  return capturedRequests;
}

/** The most recent captured request, or `undefined` if none has been made yet. */
export function getLastRequest(): CapturedRequest | undefined {
  return capturedRequests[capturedRequests.length - 1];
}

async function capture(request: Request): Promise<void> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  // Clone before reading — msw's handler still needs the original request usable afterward, and a
  // body can only be read once from a given Request/clone.
  const clone = request.clone();
  const text = await clone.text();
  let body: unknown;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  capturedRequests.push({ method: request.method, url: request.url, headers, body });
}

// ---------------------------------------------------------------------------------------------
// Mock response bodies — deliberately realistic, matching the exact shapes confirmed live
// elsewhere in this project (see test/resources/*.test.ts fixtures), not placeholder data.
// ---------------------------------------------------------------------------------------------

const mockBillingPeriod = {
  pbp_id: "pbp_a1104f81b",
  interval_type: "month",
  interval_count: 1,
  label: "Monthly",
  price: "500.00",
  currency: "NPR",
  is_current: true,
  is_limited: false,
  is_archived: false,
  offers: [],
};

const mockPlan = {
  plan_id: "3",
  plan_name: "Standard",
  description: "Standard plan",
  billing_periods: [mockBillingPeriod],
};

const mockProduct = {
  product_id: "de337e17-59a1-4dea-b8b2-1877b9813ebc",
  name: "Test Product",
  description: "",
  type: "tiered",
  is_active: true,
  // openapi.yaml declares both as plain `{ type: string }` — non-nullable — not `null` (found in
  // review: the fixture must match what it claims to mirror, since nothing else checks it).
  terms_and_conditions: "Standard terms apply.",
  features_and_benefits: "Includes priority support.",
  vat: { is_vat_active: false, vat_type: "inclusive", vat_percentage: "0.00" },
  product_image: [],
  plan: [mockPlan],
  total_subscribers: "1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

// Non-null billing/shipping, deliberately (found in review) — an all-null fixture would never
// exercise SubscriptionCustomer's billing/shipping deserialization at all, the one genuinely
// asymmetric part of the customer/client boundary (unprefixed here on the read side, unlike
// ClientWrite's billing_-prefixed fields — see src/resources/serialization.ts).
const mockClientRead = {
  phone: "9800000000",
  full_name: "Jane Doe",
  email: "jane@example.com",
  address: "Kathmandu",
  billing: { business_name: "Doe Traders", email: "billing@example.com", address: "Lalitpur", pan_vat: "123456789" },
  shipping: { phone: "9811111111", full_name: "John Doe", email: "john@example.com", address: "Bhaktapur" },
};

const mockSubscriptionProduct = {
  product_id: "de337e17-59a1-4dea-b8b2-1877b9813ebc",
  name: "Test Product",
  plan_name: "Standard",
  pbp_id: "pbp_a1104f81b",
  label: "Monthly",
  price: "500.00",
  currency: "NPR",
};

const mockSubscription = {
  subscription_id: "30b0af58-c8bc-4f79-9917-51208b73a0ed",
  status: "active",
  is_active: true,
  client: mockClientRead,
  product: mockSubscriptionProduct,
  current_period_start: "2026-01-01T00:00:00Z",
  current_period_end: "2026-02-01T00:00:00Z",
  next_billing_cycle: "2026-02-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
};

const mockCustomer = {
  id: 42,
  buyer_phone: "9800000000",
  buyer_email: "jane@example.com",
  full_name: "Jane Doe",
  created_at: "2026-01-01T00:00:00Z",
};

/** One `msw` handler per documented operation in `specs/openapi.yaml`. */
export const handlers: HttpHandler[] = [
  http.get(`${SANDBOX_BASE_URL}/api/v1/products/`, async ({ request }) => {
    await capture(request);
    return HttpResponse.json({ count: 1, next: null, previous: null, results: [mockProduct] });
  }),

  http.get(`${SANDBOX_BASE_URL}/api/v1/subscriptions/`, async ({ request }) => {
    await capture(request);
    return HttpResponse.json({
      count: 1,
      next: null,
      previous: null,
      total_subscriptions: 1,
      active_subscriptions: 1,
      due_subscriptions: 0,
      inactive_subscriptions: 0,
      results: [mockSubscription],
    });
  }),

  http.post(`${SANDBOX_BASE_URL}/api/v1/subscriptions/`, async ({ request }) => {
    await capture(request);
    return HttpResponse.json(
      {
        subscription_id: "30b0af58-c8bc-4f79-9917-51208b73a0ed",
        pbp_id: "pbp_a1104f81b",
        status: "pending_checkout",
        checkout_url: "https://pay.example/30b0af58",
        next_billing_cycle: null,
        created_at: "2026-01-01T00:00:00Z",
      },
      { status: 201 },
    );
  }),

  http.post(`${SANDBOX_BASE_URL}/api/v1/subscriptions/:id/cancel/`, async ({ request }) => {
    await capture(request);
    return HttpResponse.json({
      message: "Subscription will be cancelled at the end of the current billing period.",
    });
  }),

  http.post(`${SANDBOX_BASE_URL}/api/v1/subscriptions/update-billing-cycle/`, async ({ request }) => {
    await capture(request);
    return HttpResponse.json({ message: "Billing cycle updated." });
  }),

  http.post(`${SANDBOX_BASE_URL}/api/v1/subscriptions/:id/resume/`, async ({ request }) => {
    await capture(request);
    return HttpResponse.json({ message: "Subscription resumed." });
  }),

  http.get(`${SANDBOX_BASE_URL}/api/v1/customers/`, async ({ request }) => {
    await capture(request);
    return HttpResponse.json({ count: 1, next: null, previous: null, results: [mockCustomer] });
  }),

  http.get(`${SANDBOX_BASE_URL}/api/v1/customers/:id/`, async ({ request, params }) => {
    await capture(request);
    // Echoes back whatever id was actually requested
    // a real API returns the customer matching the id you asked for, not an unrelated fixed one.
    // A caller requesting id 999999 getting back id 42 looks like a bug even when the intent was
    // only to prove :id path-matching works, not to simulate a real per-id lookup.
    return HttpResponse.json({ ...mockCustomer, id: Number(params.id) });
  }),
];

/** The mock server instance. Started/stopped/reset by whichever test file imports it. */
export const server = setupServer(...handlers);
