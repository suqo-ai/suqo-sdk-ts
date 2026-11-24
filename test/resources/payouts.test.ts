import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../../src/http/HttpClient.js";
import { SdkConfig } from "../../src/config/SdkConfig.js";
import { PayoutsResource, deserializePayout } from "../../src/resources/payouts.js";
import {
  NotFoundError,
  ServerError,
  SuqoConfigError,
  ValidationError,
} from "../../src/errors/SuqoError.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function payouts(): PayoutsResource {
  const config = new SdkConfig({ apiKey: "su_test_key_abc123" });
  const http = new HttpClient(config, { sleep: async () => {} });
  return new PayoutsResource(http);
}

// Swagger's own example.
const wirePayout = {
  payout_id: "PYT-MF4G9W-CTEP55",
  status: "PENDING",
  amount: "12500.00",
  provider_charge: "250.00",
  suqo_platform_fee: "375.00",
  sms_charge: "40.00",
  net_amount: "11835.00",
  requested_date: "2026-07-03T10:15:00Z",
  paid_date: null,
  receipt_url: null,
};

const payout = {
  payoutId: "PYT-MF4G9W-CTEP55",
  status: "PENDING",
  amount: "12500.00",
  providerCharge: "250.00",
  suqoPlatformFee: "375.00",
  smsCharge: "40.00",
  netAmount: "11835.00",
  requestedDate: "2026-07-03T10:15:00Z",
  paidDate: null,
  receiptUrl: null,
};

describe("deserializePayout", () => {
  it("maps every field to camelCase and keeps decimals as strings", () => {
    expect(deserializePayout(wirePayout)).toEqual(payout);
  });

  it("decodes a test-dev-be response untouched: 2-decimal amounts, +05:45 offset with microseconds", () => {
    const wire = {
      payout_id: "PYT-E5X222-LP497U",
      status: "PENDING",
      amount: "16370.00",
      provider_charge: "13.95",
      suqo_platform_fee: "325.74",
      sms_charge: "13.41",
      requested_date: "2026-11-05T15:58:47.196194+05:45",
      paid_date: null,
      receipt_url: null,
      net_amount: "16016.90",
    };
    expect(deserializePayout(wire)).toEqual({
      payoutId: "PYT-E5X222-LP497U",
      status: "PENDING",
      amount: "16370.00",
      providerCharge: "13.95",
      suqoPlatformFee: "325.74",
      smsCharge: "13.41",
      netAmount: "16016.90",
      requestedDate: "2026-11-05T15:58:47.196194+05:45",
      paidDate: null,
      receiptUrl: null,
    });
  });

  it("decodes a real COMPLETED payout: paidDate without microseconds, receiptUrl still null", () => {
    const result = deserializePayout({
      payout_id: "PYT-E5X222-LP497U",
      status: "COMPLETED",
      amount: "16370.00",
      provider_charge: "13.95",
      suqo_platform_fee: "325.74",
      sms_charge: "13.41",
      requested_date: "2026-11-05T15:58:47.196194+05:45",
      paid_date: "2026-11-23T13:21:48+05:45",
      receipt_url: null,
      net_amount: "16016.90",
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.paidDate).toBe("2026-11-23T13:21:48+05:45");
    expect(result.receiptUrl).toBeNull();
  });

  it("an omitted paid_date/receipt_url decodes to null, not undefined", () => {
    const { paid_date: _p, receipt_url: _r, ...rest } = wirePayout;
    const result = deserializePayout(rest);
    expect(result.paidDate).toBeNull();
    expect(result.receiptUrl).toBeNull();
  });

  it("keeps a COMPLETED payout's paid date and receipt, and an unknown status as-is", () => {
    const result = deserializePayout({
      ...wirePayout,
      status: "REVERSED",
      paid_date: "2026-07-05T08:00:00Z",
      receipt_url: "https://cdn.example/r.pdf",
    });
    expect(result.status).toBe("REVERSED");
    expect(result.paidDate).toBe("2026-07-05T08:00:00Z");
    expect(result.receiptUrl).toBe("https://cdn.example/r.pdf");
  });
});

describe("PayoutsResource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("list() hits GET /api/v1/payouts/ with the mapped page params and decodes the page", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ count: 1, next: null, previous: null, results: [wirePayout] }),
    );

    const page = await payouts().list({ page: 2, pageSize: 50 });

    expect(fetch).toHaveBeenCalledWith(
      "https://test-be.suqo.ai/api/v1/payouts/?page=2&page_size=50",
      expect.objectContaining({ method: "GET" }),
    );
    expect(page).toEqual({ count: 1, next: null, previous: null, results: [payout] });
  });

  it("autoPaging() follows next until null", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          count: 2,
          next: "https://test-be.suqo.ai/api/v1/payouts/?page=2",
          previous: null,
          results: [wirePayout],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          count: 2,
          next: null,
          previous: null,
          results: [{ ...wirePayout, payout_id: "PYT-2" }],
        }),
      );

    const ids: string[] = [];
    for await (const p of payouts().autoPaging()) ids.push(p.payoutId);

    expect(ids).toEqual(["PYT-MF4G9W-CTEP55", "PYT-2"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retrieve() hits GET /api/v1/payouts/{public_id}/, URL-encoded", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(wirePayout));

    const result = await payouts().retrieve("PYT-MF4G9W-CTEP55");

    expect(fetch).toHaveBeenCalledWith(
      "https://test-be.suqo.ai/api/v1/payouts/PYT-MF4G9W-CTEP55/",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toEqual(payout);

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(wirePayout));
    await payouts().retrieve("a/b?c");
    expect(fetch).toHaveBeenLastCalledWith(
      "https://test-be.suqo.ai/api/v1/payouts/a%2Fb%3Fc/",
      expect.anything(),
    );
  });

  it("create() POSTs /api/v1/payouts/ with no body and decodes the real 201", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        {
          payout_id: "PYT-W2JKJC-XGPJJ8",
          status: "PENDING",
          amount: "8175.00",
          provider_charge: "92.38",
          suqo_platform_fee: "23.71",
          sms_charge: "5.96",
          requested_date: "2026-11-23T13:28:04.572959+05:45",
          paid_date: null,
          receipt_url: null,
          net_amount: "8052.95",
        },
        201,
      ),
    );

    const result = await payouts().create();

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://test-be.suqo.ai/api/v1/payouts/");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    expect(result.payoutId).toBe("PYT-W2JKJC-XGPJJ8");
    expect(result.netAmount).toBe("8052.95");
    expect(result.paidDate).toBeNull();
  });

  it.each([
    ["You already have a pending payout request.", "pending_payout_request_exists"],
    ["Your net payable amount is below the minimum payout amount.", "payout_below_minimum"],
  ])("create() refusal %j is a ValidationError, code read from rawBody", async (detail, code) => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ detail, code }, 400));

    const err = await payouts().create().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toBe(detail);
    expect((err as ValidationError).fieldErrors).toEqual({});
    expect((err as ValidationError).rawBody).toEqual({ detail, code });
  });

  it("create() is never retried, even on a 5xx", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: "boom" }, 503));
    await expect(payouts().create()).rejects.toBeInstanceOf(ServerError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["", ".", ".."])("retrieve(%j) throws SuqoConfigError before any request", async (id) => {
    await expect(payouts().retrieve(id)).rejects.toBeInstanceOf(SuqoConfigError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retrieve() of an unknown id is a NotFoundError", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ detail: "Not found." }, 404));
    await expect(payouts().retrieve("PYT-NOPE")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reads are retried on a 5xx", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ detail: "boom" }, 503))
      .mockResolvedValueOnce(jsonResponse(wirePayout));

    await expect(payouts().retrieve("PYT-MF4G9W-CTEP55")).resolves.toEqual(payout);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
