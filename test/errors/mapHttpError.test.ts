import { describe, expect, it } from "vitest";
import {
  AuthenticationError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  SDKError,
  ServerError,
  ValidationError,
} from "../../src/errors/SDKError.js";
import { mapHttpError } from "../../src/errors/mapHttpError.js";

describe("mapHttpError", () => {
  it("maps 401 to AuthenticationError", () => {
    expect(mapHttpError({ status: 401 })).toBeInstanceOf(AuthenticationError);
  });

  it("maps 403 to PermissionError", () => {
    expect(mapHttpError({ status: 403 })).toBeInstanceOf(PermissionError);
  });

  it("maps 404 to NotFoundError", () => {
    expect(mapHttpError({ status: 404 })).toBeInstanceOf(NotFoundError);
  });

  it.each([400, 422])("maps %i to ValidationError with issues from the body", (status) => {
    const err = mapHttpError({
      status,
      body: {
        message: "Validation failed",
        issues: [
          { path: "email", message: "must be a valid email" },
          { path: 42, message: "ignored" },
        ],
      },
    });
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe("Validation failed");
    expect((err as ValidationError).issues).toEqual([
      { path: "email", message: "must be a valid email" },
    ]);
  });

  it("maps 429 to RateLimitError carrying retryAfterMs", () => {
    const err = mapHttpError({ status: 429, retryAfterMs: 5000 });
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(5000);
  });

  it.each([500, 502, 503, 504])("maps %i to ServerError", (status) => {
    expect(mapHttpError({ status })).toBeInstanceOf(ServerError);
  });

  it("maps an unmapped status to a generic SDKError with a stable code", () => {
    const err = mapHttpError({ status: 402 });
    expect(err).toBeInstanceOf(SDKError);
    expect(err).not.toBeInstanceOf(AuthenticationError);
    expect(err.code).toBe("http_error");
    expect(err.status).toBe(402);
  });

  it("falls back to a generic message when the body has none", () => {
    const err = mapHttpError({ status: 500, statusText: "Internal Server Error" });
    expect(err.message).toBe("Request failed with status 500 (Internal Server Error)");
  });

  it("propagates requestId onto the mapped error", () => {
    const err = mapHttpError({ status: 404, requestId: "req_abc" });
    expect(err.requestId).toBe("req_abc");
  });

  it("only RateLimitError (429) carries retryAfterMs, not other 4xx errors", () => {
    const err = mapHttpError({ status: 400 });
    expect(err).not.toHaveProperty("retryAfterMs");
  });
});
