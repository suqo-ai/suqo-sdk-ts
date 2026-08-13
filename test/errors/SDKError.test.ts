import { describe, expect, it } from "vitest";
import {
  AuthenticationError,
  NetworkError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  SDKError,
  ServerError,
  TimeoutError,
  ValidationError,
} from "../../src/errors/SDKError.js";

const SUBCLASSES = [
  ["AuthenticationError", AuthenticationError, "authentication_error"],
  ["PermissionError", PermissionError, "permission_error"],
  ["ValidationError", ValidationError, "validation_error"],
  ["NotFoundError", NotFoundError, "not_found"],
  ["RateLimitError", RateLimitError, "rate_limited"],
  ["ServerError", ServerError, "server_error"],
  ["NetworkError", NetworkError, "network_error"],
  ["TimeoutError", TimeoutError, "timeout_error"],
] as const;

describe("SDKError hierarchy", () => {
  it.each(SUBCLASSES)("%s is an Error and an SDKError with a stable code", (name, Ctor, code) => {
    const err = new Ctor("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SDKError);
    expect(err.name).toBe(name);
    expect(err.code).toBe(code);
    expect(err.message).toBe("boom");
  });

  it("carries status and requestId when provided", () => {
    const err = new NotFoundError("missing", { status: 404, requestId: "req_123" });
    expect(err.status).toBe(404);
    expect(err.requestId).toBe("req_123");
  });

  it("omits status/requestId entirely when not provided (exactOptionalPropertyTypes-safe)", () => {
    const err = new AuthenticationError("nope");
    expect("status" in err).toBe(false);
    expect("requestId" in err).toBe(false);
  });

  it("preserves the original cause", () => {
    const cause = new Error("dns failure");
    const err = new NetworkError("network down", { cause });
    expect(err.cause).toBe(cause);
  });

  it("ValidationError carries field-level issues", () => {
    const err = new ValidationError("invalid input", {
      issues: [{ path: "email", message: "must be a valid email" }],
    });
    expect(err.issues).toEqual([{ path: "email", message: "must be a valid email" }]);
  });

  it("ValidationError defaults issues to an empty array", () => {
    expect(new ValidationError("invalid input").issues).toEqual([]);
  });

  it("RateLimitError carries retryAfterMs", () => {
    const err = new RateLimitError("slow down", { retryAfterMs: 2000 });
    expect(err.retryAfterMs).toBe(2000);
  });

  it("TimeoutError carries timeoutMs", () => {
    const err = new TimeoutError("took too long", { timeoutMs: 15_000 });
    expect(err.timeoutMs).toBe(15_000);
  });

  it("base SDKError is directly constructible for unmapped cases", () => {
    const err = new SDKError("weird status", "http_error", { status: 418 });
    expect(err).toBeInstanceOf(SDKError);
    expect(err.code).toBe("http_error");
    expect(err.status).toBe(418);
  });
});
