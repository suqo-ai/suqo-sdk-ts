import { describe, expect, it } from "vitest";
import {
  AuthenticationError,
  KycRequiredError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ServerError,
  SuqoConfigError,
  SuqoError,
  ValidationError,
} from "../../src/errors/SuqoError.js";

const SUBCLASSES = [
  ["SuqoConfigError", SuqoConfigError],
  ["AuthenticationError", AuthenticationError],
  ["KycRequiredError", KycRequiredError],
  ["ValidationError", ValidationError],
  ["NotFoundError", NotFoundError],
  ["RateLimitError", RateLimitError],
  ["ServerError", ServerError],
  ["NetworkError", NetworkError],
] as const;

describe("SuqoError hierarchy", () => {
  it.each(SUBCLASSES)("%s is an Error and a SuqoError with the right name", (name, Ctor) => {
    const err = new Ctor("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SuqoError);
    expect(err.name).toBe(name);
    expect(err.message).toBe("boom");
  });

  it("carries status, rawBody, and requestId when provided", () => {
    const err = new NotFoundError("missing", {
      status: 404,
      rawBody: { detail: "missing" },
      requestId: "req_123",
    });
    expect(err.status).toBe(404);
    expect(err.rawBody).toEqual({ detail: "missing" });
    expect(err.requestId).toBe("req_123");
  });

  it("omits status/requestId entirely when not provided (exactOptionalPropertyTypes-safe)", () => {
    const err = new AuthenticationError("nope");
    expect("status" in err).toBe(false);
    expect("requestId" in err).toBe(false);
    // rawBody is always present (its type is `unknown`, so `undefined` is a valid value) —
    // but it's still `undefined` when nothing was passed.
    expect(err.rawBody).toBeUndefined();
  });

  it("preserves the original cause", () => {
    const cause = new Error("dns failure");
    const err = new NetworkError("network down", { cause });
    expect(err.cause).toBe(cause);
  });

  it("SuqoConfigError never carries status/rawBody — there was no request", () => {
    const err = new SuqoConfigError("Malformed SUQO API key: expected prefix ...");
    expect(err).toBeInstanceOf(SuqoError);
    expect(err.status).toBeUndefined();
    expect(err.rawBody).toBeUndefined();
  });

  it("ValidationError carries fieldErrors and defaults to an empty object", () => {
    const withFields = new ValidationError("Validation failed.", {
      fieldErrors: { pbp_id: ["does not exist"] },
    });
    expect(withFields.fieldErrors).toEqual({ pbp_id: ["does not exist"] });

    const withoutFields = new ValidationError("An active subscription already exists.");
    expect(withoutFields.fieldErrors).toEqual({});
  });

  it("KycRequiredError carries kycStatus when provided, undefined otherwise", () => {
    const withCode = new KycRequiredError("KYC needed", { kycStatus: "pending" });
    expect(withCode.kycStatus).toBe("pending");

    const withoutCode = new KycRequiredError("KYC needed");
    expect(withoutCode.kycStatus).toBeUndefined();
  });

  it("RateLimitError carries retryAfter when provided", () => {
    const err = new RateLimitError("slow down", { retryAfter: 2000 });
    expect(err.retryAfter).toBe(2000);
  });

  it("base SuqoError is constructible, but the SDK itself never throws it directly (SDK-SPEC.md §7)", () => {
    const err = new SuqoError("weird status", { status: 418 });
    expect(err).toBeInstanceOf(SuqoError);
    expect(err.status).toBe(418);
  });
});
