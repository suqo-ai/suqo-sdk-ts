import { describe, expect, it } from "vitest";
import { mapHttpError } from "../../src/errors/mapHttpError.js";
import {
  AuthenticationError,
  KycRequiredError,
  NotFoundError,
  RateLimitError,
  ServerError,
  SuqoError,
  ValidationError,
} from "../../src/errors/SuqoError.js";

describe("mapHttpError", () => {
  it("maps 401 to AuthenticationError, using the detail body as the message", () => {
    const err = mapHttpError({ status: 401, body: { detail: "Invalid or inactive API key." } });
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.message).toBe("Invalid or inactive API key.");
    expect(err.status).toBe(401);
  });

  it("maps 403 to KycRequiredError, exposing kycStatus from the KycError body", () => {
    const err = mapHttpError({
      status: 403,
      body: { status_code: "pending", message: "KYC verification needed to perform this action." },
    });
    expect(err).toBeInstanceOf(KycRequiredError);
    expect((err as KycRequiredError).kycStatus).toBe("pending");
    expect(err.message).toBe("KYC verification needed to perform this action.");
  });

  it("403 without a status_code leaves kycStatus undefined rather than guessing", () => {
    const err = mapHttpError({ status: 403, body: {} }) as KycRequiredError;
    expect(err).toBeInstanceOf(KycRequiredError);
    expect(err.kycStatus).toBeUndefined();
  });

  it("maps a field-keyed 400 to ValidationError.fieldErrors, normalizing string values to arrays", () => {
    const err = mapHttpError({
      status: 400,
      body: {
        pbp_id: "PlanBillingPeriod with public_id '...' does not exist or is not visible.",
        next_billing_cycle: ["next_billing_cycle must be in the future or today."],
      },
    }) as ValidationError;
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.fieldErrors).toEqual({
      pbp_id: ["PlanBillingPeriod with public_id '...' does not exist or is not visible."],
      next_billing_cycle: ["next_billing_cycle must be in the future or today."],
    });
  });

  it("flattens a nested client validation error to customer.<field> (confirmed live 2026-08-24, POST /subscriptions/)", () => {
    // Real response body, captured live: a missing customer.phone comes back nested under
    // "client" as an object, not a flat "client.phone" key — SDK Naming Map v1.1 Open Question A.
    const err = mapHttpError({
      status: 400,
      body: { client: { phone: ["This field is required."] } },
    }) as ValidationError;
    expect(err.fieldErrors).toEqual({ "customer.phone": ["This field is required."] });
    expect(err.fieldErrors).not.toHaveProperty("client.phone");
  });

  it("flattens multiple nested customer fields independently, each under its own customer.<field> key", () => {
    const err = mapHttpError({
      status: 400,
      body: {
        client: {
          phone: ["This field is required."],
          email: "Enter a valid email address.",
        },
      },
    }) as ValidationError;
    expect(err.fieldErrors).toEqual({
      "customer.phone": ["This field is required."],
      "customer.email": ["Enter a valid email address."],
    });
  });

  it("renames a whole-object client error (string/array, not nested) straight to customer, with no dot-path", () => {
    const err = mapHttpError({
      status: 400,
      body: { client: "This field is required." },
    }) as ValidationError;
    expect(err.fieldErrors).toEqual({ customer: ["This field is required."] });
  });

  it("a field literally named client NESTED under another field is left untouched — only the root client key renames", () => {
    const err = mapHttpError({
      status: 400,
      body: { billing: { client: ["not the customer boundary — a coincidental nested name"] } },
    }) as ValidationError;
    expect(err.fieldErrors).toEqual({ "billing.client": ["not the customer boundary — a coincidental nested name"] });
  });

  it("a field value shaped as a list of objects is skipped, not recursed into with numeric-index paths (found in review)", () => {
    const err = mapHttpError({
      status: 400,
      body: { billing: [{ business_name: ["required"] }] },
    }) as ValidationError;
    expect(err.fieldErrors).toEqual({});
    expect(err.fieldErrors).not.toHaveProperty("billing.0.business_name");
  });

  it("maps a detail-shaped 400 (e.g. duplicate active subscription) to ValidationError.message, fieldErrors empty", () => {
    const err = mapHttpError({
      status: 400,
      body: { detail: "An active subscription already exists for this buyer, product, and billing period." },
    }) as ValidationError;
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe(
      "An active subscription already exists for this buyer, product, and billing period.",
    );
    expect(err.fieldErrors).toEqual({});
  });

  it("maps 404 to NotFoundError", () => {
    const err = mapHttpError({ status: 404, body: { detail: "Not found." } });
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.message).toBe("Not found.");
  });

  it("maps 429 to RateLimitError, carrying retryAfter when given (reserved — SDK-SPEC.md §10)", () => {
    const err = mapHttpError({ status: 429, retryAfter: 5000 }) as RateLimitError;
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfter).toBe(5000);
  });

  it.each([500, 502, 503, 504])("maps %i to ServerError", (status) => {
    expect(mapHttpError({ status })).toBeInstanceOf(ServerError);
  });

  it("falls back to ServerError for a genuinely unmapped status, never the bare SuqoError base", () => {
    const err = mapHttpError({ status: 402 });
    expect(err).toBeInstanceOf(ServerError);
    expect(err).toBeInstanceOf(SuqoError);
  });

  it("falls back to a generic message when the body has neither detail nor message", () => {
    const err = mapHttpError({ status: 500, statusText: "Internal Server Error" });
    expect(err.message).toBe("Request failed with status 500 (Internal Server Error)");
  });

  it("propagates requestId onto the mapped error", () => {
    const err = mapHttpError({ status: 404, requestId: "req_abc" });
    expect(err.requestId).toBe("req_abc");
  });

  it("carries the raw body through as rawBody, unmodified", () => {
    const body = { detail: "Not found." };
    const err = mapHttpError({ status: 404, body });
    expect(err.rawBody).toBe(body);
  });

  it("a field value that's neither a string nor a string array is skipped, not fabricated", () => {
    const err = mapHttpError({
      status: 400,
      body: { weird_field: 42, good_field: "a real message" },
    }) as ValidationError;
    expect(err.fieldErrors).toEqual({ good_field: ["a real message"] });
  });
});
