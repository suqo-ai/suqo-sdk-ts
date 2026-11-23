import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../../src/http/HttpClient.js";
import { SdkConfig } from "../../src/config/SdkConfig.js";
import { ByopResource, deserializePaymentMethod } from "../../src/resources/byop.js";
import {
  PermissionDeniedError,
  RateLimitError,
  SuqoConfigError,
  ValidationError,
} from "../../src/errors/SuqoError.js";
import type { ByopCredentials } from "../../src/models/index.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function byop(): ByopResource {
  const config = new SdkConfig({ apiKey: "su_test_key_abc123" });
  return new ByopResource(new HttpClient(config, { sleep: async () => {} }));
}

const KHALTI: ByopCredentials = { paymentType: "khalti", merchantSecret: "s" };
const NPS: ByopCredentials = {
  paymentType: "nps",
  merchantId: "m1",
  merchantName: "Shop",
  apiUsername: "u",
  apiPassword: "p",
  merchantSecret: "s",
  isWebhooksUrlSet: true,
};

const PM_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const BASE = "https://test-be.suqo.ai/api/v1/byop";

// Shape confirmed against a captured GET /api/v1/byop/payment-methods/ (2026-11-20); values invented.
const wirePaymentMethod = {
  company_id: "00000000-0000-0000-0000-000000000001",
  payment_type_id: PM_ID,
  payment_type: "esewa_intent",
  alias: "eSewa Intent",
  logo: "https://cdn.example.com/esewa.png",
  order: 0,
  is_active: false,
  fee: "1.75",
  is_configured: true,
  is_verified: false,
};

const paymentMethod = {
  companyId: "00000000-0000-0000-0000-000000000001",
  paymentTypeId: PM_ID,
  paymentType: "esewa_intent",
  alias: "eSewa Intent",
  logo: "https://cdn.example.com/esewa.png",
  order: 0,
  isActive: false,
  fee: "1.75",
  isConfigured: true,
  isVerified: false,
};

function lastCall(): { url: string; method: string | undefined; body: unknown } {
  const [url, init] = vi.mocked(fetch).mock.calls.at(-1)!;
  return {
    url: url as string,
    method: init?.method,
    body: init?.body === undefined ? undefined : JSON.parse(init.body as string),
  };
}

describe("deserializePaymentMethod", () => {
  it("maps to camelCase, keeping fee a string", () => {
    expect(deserializePaymentMethod(wirePaymentMethod)).toEqual(paymentMethod);
  });

  it("decodes omitted nullable keys as null, not undefined", () => {
    const { alias, logo, fee, is_verified, ...rest } = wirePaymentMethod;
    (void alias, void logo, void fee, void is_verified);
    expect(deserializePaymentMethod(rest)).toMatchObject({
      alias: null,
      logo: null,
      fee: null,
      isVerified: null,
    });
  });
});

describe("ByopResource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listPaymentMethods() GETs /byop/payment-methods/ and maps the unpaginated array", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([wirePaymentMethod]));
    await expect(byop().listPaymentMethods()).resolves.toEqual([paymentMethod]);
    expect(lastCall()).toMatchObject({ url: `${BASE}/payment-methods/`, method: "GET" });
  });

  it("saveCredentials() PATCHes the full set with snake_case keys, without paymentType, and resolves void", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "Credentials saved successfully." }),
    );
    await expect(byop().saveCredentials(PM_ID, NPS)).resolves.toBeUndefined();
    expect(lastCall()).toEqual({
      url: `${BASE}/credentials/${PM_ID}/`,
      method: "PATCH",
      body: {
        merchant_id: "m1",
        merchant_name: "Shop",
        api_username: "u",
        api_password: "p",
        merchant_secret: "s",
        is_webhooks_url_set: true,
      },
    });
  });

  it("saveCredentials() surfaces byop_payment_pending as ValidationError, and never retries", async () => {
    const body = { detail: "A payment is still being processed.", code: "byop_payment_pending" };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(body, 400));
    const err = await byop()
      .saveCredentials(PM_ID, KHALTI)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toBe(body.detail);
    expect((err as ValidationError).rawBody).toEqual(body);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("a write on a non-BYOP account is PermissionDeniedError", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ detail: "Your own payment account isn't enabled." }, 403),
    );
    await expect(byop().updateProcessingFee(PM_ID, { processingFee: "1" })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("a 429 is RateLimitError with retryAfter read from detail, and is not retried", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ detail: "Request was throttled. Expected available in 41 seconds." }, 429),
    );
    const err = await byop()
      .saveCredentials(PM_ID, KHALTI)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBe(41_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("updateProcessingFee() PATCHes processing_fee as a string and returns it", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ processing_fee: "1.75" }));
    await expect(byop().updateProcessingFee(PM_ID, { processingFee: "1.75" })).resolves.toEqual({
      processingFee: "1.75",
    });
    expect(lastCall()).toEqual({
      url: `${BASE}/fees/${PM_ID}/`,
      method: "PATCH",
      body: { processing_fee: "1.75" },
    });
  });

  it('updateProcessingFee() returns the fee as the API normalizes it ("1.5" → "1.50"), still a string', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ processing_fee: "1.50" }));
    await expect(byop().updateProcessingFee(PM_ID, { processingFee: "1.5" })).resolves.toEqual({
      processingFee: "1.50",
    });
  });

  it("updateProcessingFee() surfaces an out-of-range fee as a field error (captured 400)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ processing_fee: ["Ensure this value is less than or equal to 100."] }, 400),
    );
    const err = await byop()
      .updateProcessingFee(PM_ID, { processingFee: "150" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fieldErrors).toEqual({
      processing_fee: ["Ensure this value is less than or equal to 100."],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("updateProcessingFee() sends null to clear the fee", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ processing_fee: null }));
    await expect(byop().updateProcessingFee(PM_ID, { processingFee: null })).resolves.toEqual({
      processingFee: null,
    });
    expect(lastCall().body).toEqual({ processing_fee: null });
  });

  it("updateProcessingFee() surfaces the Khalti/NPS refusal as a field error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ processing_fee: ["This gateway reports its own fee on each payment."] }, 400),
    );
    const err = await byop()
      .updateProcessingFee(PM_ID, { processingFee: "1" })
      .catch((e: unknown) => e);
    expect((err as ValidationError).fieldErrors).toEqual({
      processing_fee: ["This gateway reports its own fee on each payment."],
    });
  });

  it.each(["", ".", ".."])("rejects path id %j before any request", async (id) => {
    await expect(byop().saveCredentials(id, KHALTI)).rejects.toBeInstanceOf(SuqoConfigError);
    await expect(byop().updateProcessingFee(id, { processingFee: null })).rejects.toBeInstanceOf(
      SuqoConfigError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  // Review finding: two keys colliding on one wire key used to save a stale secret.
  it("saveCredentials() refuses a snake_case key before any request", async () => {
    await expect(
      byop().saveCredentials(PM_ID, {
        ...KHALTI,
        merchant_secret: "old",
      } as unknown as ByopCredentials),
    ).rejects.toBeInstanceOf(SuqoConfigError);
    expect(fetch).not.toHaveBeenCalled();
  });

  // Design review: the API validates the set, so a gateway added after this release still works.
  it("saveCredentials() sends an unknown paymentType's keys snake_cased", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "Credentials saved successfully." }),
    );
    await byop().saveCredentials(PM_ID, {
      paymentType: "newpay",
      shopToken: "t",
    } as unknown as ByopCredentials);
    expect(lastCall().body).toEqual({ shop_token: "t" });
  });

  it("saveCredentials() leaves a missing field to the API, surfaced as ValidationError", async () => {
    const body = { product_code: ["This field is required."] };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(body, 400));
    const err = await byop()
      .saveCredentials(PM_ID, { paymentType: "esewa", merchantSecret: "s" } as ByopCredentials)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fieldErrors).toEqual(body);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each<ByopCredentials>([
    { paymentType: "esewa_intent", productCode: "EPAYTEST", merchantSecret: "s" },
    {
      paymentType: "connectips",
      merchantId: "m",
      appId: "a",
      appName: "n",
      appPassword: "p",
      pfx: "TUlJ",
      pfxPassword: "q",
      isResponseUrlConfirmation: true,
    },
    {
      paymentType: "fonepay-checkout",
      username: "u",
      password: "p",
      privateKey: "TUlJ",
      terminalId: "t",
    },
  ])("saveCredentials() accepts a full $paymentType set", async (credentials) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "Credentials saved successfully." }),
    );
    await expect(byop().saveCredentials(PM_ID, credentials)).resolves.toBeUndefined();
    expect(lastCall().body).not.toHaveProperty("payment_type");
  });

  // Review findings: a missing processingFee sent `{}` (read back as "cleared"); a number sent a float.
  it.each<[string, unknown]>([
    ["a missing processingFee (wrong key from JS)", { fee: "1.5" }],
    ["a number processingFee", { processingFee: 1.75 }],
  ])("updateProcessingFee() refuses %s before any request", async (_name, params) => {
    await expect(
      byop().updateProcessingFee(PM_ID, params as { processingFee: string }),
    ).rejects.toBeInstanceOf(SuqoConfigError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
