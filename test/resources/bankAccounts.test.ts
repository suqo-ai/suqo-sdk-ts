import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../../src/http/HttpClient.js";
import { SdkConfig } from "../../src/config/SdkConfig.js";
import { BankAccountsResource, deserializeBankAccount } from "../../src/resources/bankAccounts.js";
import {
  NotFoundError,
  RateLimitError,
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

function bankAccounts(): BankAccountsResource {
  const config = new SdkConfig({ apiKey: "su_test_key_abc123" });
  const http = new HttpClient(config, { sleep: async () => {} });
  return new BankAccountsResource(http);
}

// Swagger's own example.
const wireAccount = {
  id: 42,
  bank_name: "Nabil Bank",
  account_name: "Himalayan Tea Pvt. Ltd.",
  branch: "Kathmandu",
  account_number_masked: "****4521",
  verified_at: "2026-07-03T10:15:00Z",
  created_at: "2026-07-03T10:05:00Z",
  updated_at: "2026-07-03T10:15:00Z",
};

const account = {
  id: 42,
  bankName: "Nabil Bank",
  accountName: "Himalayan Tea Pvt. Ltd.",
  branch: "Kathmandu",
  accountNumberMasked: "****4521",
  verifiedAt: "2026-07-03T10:15:00Z",
  createdAt: "2026-07-03T10:05:00Z",
  updatedAt: "2026-07-03T10:15:00Z",
};

const BASE = "https://test-be.suqo.ai/api/v1/bank-accounts/";

function lastCall(): { url: string; method: string | undefined; body: unknown } {
  const [url, init] = vi.mocked(fetch).mock.calls.at(-1)!;
  return {
    url: String(url),
    method: init?.method,
    body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
  };
}

describe("deserializeBankAccount", () => {
  it("maps every field to camelCase", () => {
    expect(deserializeBankAccount(wireAccount)).toEqual(account);
  });

  it("an unverified account has verifiedAt null, whether the key is null or omitted", () => {
    const { verified_at: _omit, ...omitted } = wireAccount;
    expect(deserializeBankAccount({ ...wireAccount, verified_at: null }).verifiedAt).toBeNull();
    expect(deserializeBankAccount(omitted).verifiedAt).toBeNull();
  });
});

describe("BankAccountsResource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("list() GETs /bank-accounts/ and decodes the bare array (not paginated)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([wireAccount]));
    await expect(bankAccounts().list()).resolves.toEqual([account]);
    expect(lastCall()).toEqual({ url: BASE, method: "GET", body: undefined });
  });

  it("create() POSTs the details snake_case", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ...wireAccount, verified_at: null }, 201));
    const result = await bankAccounts().create({
      bankName: "Nabil Bank",
      accountName: "Himalayan Tea Pvt. Ltd.",
      accountNumber: "0123456789",
      branch: "Kathmandu",
    });
    expect(lastCall()).toEqual({
      url: BASE,
      method: "POST",
      body: {
        bank_name: "Nabil Bank",
        account_name: "Himalayan Tea Pvt. Ltd.",
        account_number: "0123456789",
        branch: "Kathmandu",
      },
    });
    expect(result.verifiedAt).toBeNull();
  });

  it("create() over the limit is a ValidationError with code in rawBody", async () => {
    const body = {
      detail: "You have reached the maximum number of bank accounts allowed.",
      code: "bank_account_limit_reached",
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(body, 400));
    const err = await bankAccounts()
      .create({ bankName: "a", accountName: "b", accountNumber: "0123456", branch: "c" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toBe(body.detail);
    expect((err as ValidationError).rawBody).toEqual(body);
  });

  it("retrieve(id) GETs /bank-accounts/{id}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(wireAccount));
    await expect(bankAccounts().retrieve(42)).resolves.toEqual(account);
    expect(lastCall().url).toBe(`${BASE}42/`);
  });

  it("update() PATCHes the code as a string (sent as given) plus only the given details", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(wireAccount));
    await bankAccounts().update(42, { code: "012345", branch: "Lalitpur" });
    expect(lastCall()).toEqual({
      url: `${BASE}42/`,
      method: "PATCH",
      body: { code: "012345", branch: "Lalitpur" },
    });
  });

  it("a wrong OTP ({ code: msg }) is fieldErrors.code, not a coded refusal", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ code: "Invalid or expired code." }, 400));
    const err = await bankAccounts().update(42, { code: "000000" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fieldErrors).toEqual({ code: ["Invalid or expired code."] });
  });

  it("update() while a payout is pending is a ValidationError with code in rawBody (captured)", async () => {
    const body = {
      detail: "This bank account has a pending payout request and cannot be modified.",
      code: "bank_account_has_active_payout",
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(body, 400));
    const err = await bankAccounts().update(6, { code: "123456" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fieldErrors).toEqual({});
    expect((err as ValidationError).rawBody).toEqual(body);
  });

  it("delete(id) sends DELETE and resolves void on 204", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(bankAccounts().delete(42)).resolves.toBeUndefined();
    expect(lastCall()).toEqual({ url: `${BASE}42/`, method: "DELETE", body: undefined });
  });

  it("delete() while a payout is pending is a ValidationError with code in rawBody", async () => {
    const body = {
      detail: "This bank account has a pending payout request and cannot be modified.",
      code: "bank_account_has_active_payout",
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(body, 400));
    const err = await bankAccounts().delete(42).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fieldErrors).toEqual({});
    expect((err as ValidationError).rawBody).toEqual(body);
  });

  it("sendOtp(id) POSTs /bank-accounts/{id}/send-otp/ with no body and resolves void", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ detail: "Verification code sent." }));
    await expect(bankAccounts().sendOtp(42)).resolves.toBeUndefined();
    expect(lastCall()).toEqual({ url: `${BASE}42/send-otp/`, method: "POST", body: undefined });
  });

  it("sendOtp() rate-limited is a RateLimitError and is not retried", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ detail: "Request was throttled. Expected available in 41 seconds." }, 429),
    );
    await expect(bankAccounts().sendOtp(42)).rejects.toBeInstanceOf(RateLimitError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["create", () => bankAccounts().create({ bankName: "a", accountName: "b", accountNumber: "0123456", branch: "c" })],
    ["update", () => bankAccounts().update(42, { code: "123456" })],
    ["delete", () => bankAccounts().delete(42)],
    ["sendOtp", () => bankAccounts().sendOtp(42)],
  ])("%s() is never retried, even on a 5xx", async (_name, call) => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: "boom" }, 503));
    await expect(call()).rejects.toBeInstanceOf(ServerError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reads are retried on a 5xx", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ detail: "boom" }, 503))
      .mockResolvedValueOnce(jsonResponse(wireAccount));
    await expect(bankAccounts().retrieve(42)).resolves.toEqual(account);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retrieve() of an unknown id is a NotFoundError", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ detail: "Not found." }, 404));
    await expect(bankAccounts().retrieve(999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it.each([0, -1, 1.5, Number.NaN, "42" as unknown as number])(
    "an id of %j throws SuqoConfigError before any request",
    async (id) => {
      const r = bankAccounts();
      await expect(r.retrieve(id)).rejects.toBeInstanceOf(SuqoConfigError);
      await expect(r.update(id, { code: "123456" })).rejects.toBeInstanceOf(SuqoConfigError);
      await expect(r.delete(id)).rejects.toBeInstanceOf(SuqoConfigError);
      await expect(r.sendOtp(id)).rejects.toBeInstanceOf(SuqoConfigError);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
