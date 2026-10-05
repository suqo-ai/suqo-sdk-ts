import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../../src/http/HttpClient.js";
import { SdkConfig } from "../../src/config/SdkConfig.js";
import { CheckoutSessionsResource, deserializeCheckoutSession } from "../../src/resources/checkoutSessions.js";
import { deserializeCheckoutSessionResponse } from "../../src/resources/serialization.js";
import { NotFoundError, RateLimitError, SuqoConfigError, ValidationError } from "../../src/errors/SuqoError.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function checkoutSessions(): CheckoutSessionsResource {
  const config = new SdkConfig({ apiKey: "su_test_key_abc123" });
  const http = new HttpClient(config, { sleep: async () => {} });
  return new CheckoutSessionsResource(http);
}

const wireCreated = {
  public_id: "cks_test0001",
  expires_at: "2026-10-05T10:38:16.453690+05:45",
  checkout_url: "https://stage.suqo.ai/checkout/cks_test0001",
};

// Shape confirmed against a captured GET /api/v1/checkout-sessions/{public_id}/ (2026-10-05); the
// values here are invented. The two items differ on purpose: a catalogue item carries image_urls
// and no plan_name, a partner-priced one the reverse.
const wireCatalogueLine = {
  name: "Widget",
  amount: "1222.00",
  pbp_id: "pbp_test0001",
  currency: "NPR",
  vat_type: null,
  image_urls: [],
  interval_type: "month",
  interval_count: 1,
  vat_percentage: null,
  discount_amount: null,
  display_label: "Monthly",
  current_period_end: null,
  extends_to: "2026-11-05",
  next_payment_due: "2026-11-05",
};

const wirePartnerPricedLine = {
  name: "Onboarding setup",
  amount: "1500.00",
  pbp_id: null,
  currency: "NPR",
  vat_type: null,
  plan_name: null,
  interval_type: "month",
  interval_count: 2,
  vat_percentage: null,
  discount_amount: null,
  display_label: "Every 2 months",
  current_period_end: null,
  extends_to: "2026-12-05",
  next_payment_due: "2026-12-05",
};

const wireSession = {
  public_id: "cks_test0001",
  line_items: [wireCatalogueLine, wirePartnerPricedLine],
  customer_id: "cus_test0001",
  seller_details: {
    id: "00000000-0000-0000-0000-000000000001",
    phone: "9800000000",
    business_logo: "https://cdn.example/logo.png",
    business_name: "Example Traders",
  },
  return_url: "https://partner.example.com/orders/1234",
  expires_at: "2026-10-05T10:38:16.453690+05:45",
  completed_at: null,
  is_expired: false,
};

describe("deserializeCheckoutSessionResponse", () => {
  it("maps the opened-session link to camelCase, keeping expiresAt exactly as sent (offset included)", () => {
    expect(deserializeCheckoutSessionResponse(wireCreated)).toEqual({
      publicId: "cks_test0001",
      expiresAt: "2026-10-05T10:38:16.453690+05:45",
      checkoutUrl: "https://stage.suqo.ai/checkout/cks_test0001",
    });
  });
});

describe("deserializeCheckoutSession", () => {
  it("maps every field to camelCase, line_items as an array and is_expired as a boolean", () => {
    const session = deserializeCheckoutSession(wireSession);

    expect(session.publicId).toBe("cks_test0001");
    expect(session.customerId).toBe("cus_test0001");
    expect(session.isExpired).toBe(false);
    expect(session.completedAt).toBeNull();
    expect(session.sellerDetails).toEqual({
      id: "00000000-0000-0000-0000-000000000001",
      phone: "9800000000",
      businessLogo: "https://cdn.example/logo.png",
      businessName: "Example Traders",
    });
    expect(session).not.toHaveProperty("line_items");
  });

  it("keeps imageUrls on a catalogue item only, and planName on a partner-priced item only", () => {
    const [catalogue, partnerPriced] = deserializeCheckoutSession(wireSession).lineItems;

    expect(catalogue).toEqual({
      name: "Widget",
      amount: "1222.00",
      pbpId: "pbp_test0001",
      currency: "NPR",
      vatType: null,
      vatPercentage: null,
      discountAmount: null,
      intervalType: "month",
      intervalCount: 1,
      displayLabel: "Monthly",
      currentPeriodEnd: null,
      extendsTo: "2026-11-05",
      nextPaymentDue: "2026-11-05",
      imageUrls: [],
    });
    expect(catalogue).not.toHaveProperty("planName");

    expect(partnerPriced?.pbpId).toBeNull();
    expect(partnerPriced?.planName).toBeNull();
    expect(partnerPriced).not.toHaveProperty("imageUrls");
  });

  it("decimal fields stay strings, never coerced to numbers", () => {
    const [catalogue] = deserializeCheckoutSession(wireSession).lineItems;
    expect(typeof catalogue?.amount).toBe("string");
  });

  it("omitted nullable keys come back null, never undefined, and missing line_items an empty array", () => {
    const { customer_id: _c, completed_at: _d, line_items: _l, ...bare } = wireSession;
    const session = deserializeCheckoutSession(bare);
    expect(session.customerId).toBeNull();
    expect(session.completedAt).toBeNull();
    expect(session.lineItems).toEqual([]);
  });
});

describe("CheckoutSessionsResource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("create() POSTs both item shapes, return_url and customer_id in wire names to /api/v1/checkout-sessions/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(wireCreated, 201));

    const result = await checkoutSessions().create({
      customerId: "cus_test0001",
      returnUrl: "https://partner.example.com/orders/1234",
      items: [
        { pbpId: "pbp_test0001" },
        { name: "Onboarding setup", amount: "2500.00", intervalType: "one_time", intervalCount: 0 },
      ],
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://test-be.suqo.ai/api/v1/checkout-sessions/");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      customer_id: "cus_test0001",
      return_url: "https://partner.example.com/orders/1234",
      items: [
        { pbp_id: "pbp_test0001" },
        { name: "Onboarding setup", amount: "2500.00", interval_type: "one_time", interval_count: 0 },
      ],
    });
    expect(result.publicId).toBe("cks_test0001");
  });

  it("create() leaves customer_id out entirely when omitted, so the buyer enters their details at checkout", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(wireCreated, 201));

    await checkoutSessions().create({ returnUrl: "https://partner.example.com/r", items: [{ pbpId: "pbp_test0001" }] });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body).not.toHaveProperty("customer_id");
  });

  it("create() never sends partner-priced fields on a catalogue item, even from a non-literal object", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(wireCreated, 201));
    // A non-literal object skips TypeScript's excess-property check; the API rejects a mix.
    const item = { pbpId: "pbp_test0001", name: "stray" } as unknown as { pbpId: string };

    await checkoutSessions().create({ returnUrl: "https://partner.example.com/r", items: [item] });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.items).toEqual([{ pbp_id: "pbp_test0001" }]);
  });

  it("create() throws RateLimitError with retryAfter from the 429 detail, and never retries it", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ detail: "Request was throttled. Expected available in 41 seconds." }, 429),
    );

    const err = await checkoutSessions()
      .create({ returnUrl: "https://partner.example.com/r", items: [{ pbpId: "pbp_test0001" }] })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBe(41_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("create() surfaces a field-keyed 400 as ValidationError.fieldErrors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ return_url: ["A return URL is required."] }, 400));

    const err = await checkoutSessions()
      .create({ returnUrl: "", items: [{ pbpId: "pbp_test0001" }] })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fieldErrors).toEqual({ return_url: ["A return URL is required."] });
  });

  it("retrieve(id) GETs /api/v1/checkout-sessions/{id}/ and deserializes the session", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(wireSession));

    const session = await checkoutSessions().retrieve("cks_test0001");

    expect(fetch).toHaveBeenCalledWith(
      "https://test-be.suqo.ai/api/v1/checkout-sessions/cks_test0001/",
      expect.objectContaining({ method: "GET" }),
    );
    expect(session.lineItems).toHaveLength(2);
  });

  it("retrieve() of a paid or expired session throws NotFoundError, with return_url left in rawBody", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "This checkout link is no longer valid.", return_url: "https://partner.example.com/r" }, 404),
    );

    const err = await checkoutSessions().retrieve("cks_test0001").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).rawBody).toEqual({
      detail: "This checkout link is no longer valid.",
      return_url: "https://partner.example.com/r",
    });
  });

  it.each(["", ".", ".."])("retrieve(%j) throws SuqoConfigError before any request", async (id) => {
    await expect(checkoutSessions().retrieve(id)).rejects.toBeInstanceOf(SuqoConfigError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retrieve() URL-encodes an id containing reserved characters", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(wireSession));

    await checkoutSessions().retrieve("cks?1#a/b");

    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("https://test-be.suqo.ai/api/v1/checkout-sessions/cks%3F1%23a%2Fb/");
  });
});
