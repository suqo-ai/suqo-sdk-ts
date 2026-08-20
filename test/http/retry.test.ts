import { describe, expect, it } from "vitest";
import {
  backoffDelayMs,
  isRetryableFailure,
  isRetryableMethod,
  parseRetryAfterMs,
} from "../../src/http/retry.js";

describe("isRetryableMethod", () => {
  it("GET is retryable", () => {
    expect(isRetryableMethod("GET")).toBe(true);
  });

  it("POST (writes: create/cancel/updateBillingCycle) is never retryable", () => {
    expect(isRetryableMethod("POST")).toBe(false);
  });
});

describe("isRetryableFailure", () => {
  it("a network error (no response at all) is retryable", () => {
    expect(isRetryableFailure({ networkError: true })).toBe(true);
  });

  it("429 is retryable", () => {
    expect(isRetryableFailure({ networkError: false, status: 429 })).toBe(true);
  });

  it.each([500, 502, 503, 504])("%i (5xx) is retryable", (status) => {
    expect(isRetryableFailure({ networkError: false, status })).toBe(true);
  });

  it.each([400, 401, 403, 404])("%i is NOT retryable", (status) => {
    expect(isRetryableFailure({ networkError: false, status })).toBe(false);
  });
});

describe("backoffDelayMs", () => {
  it("stays within [0, BASE_DELAY_MS] on the first attempt", () => {
    for (let i = 0; i < 50; i++) {
      const delay = backoffDelayMs(0);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(200);
    }
  });

  it("grows with the attempt number, but stays bounded by MAX_DELAY_MS", () => {
    for (let i = 0; i < 50; i++) {
      const delay = backoffDelayMs(10); // exponential cap would be huge; must clamp
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(5000);
    }
  });

  it("later attempts have a higher ceiling than earlier ones (bounded exponential growth)", () => {
    // Not flaky: compares the *possible* ceiling via repeated sampling, not a single draw.
    const maxOfMany = (attempt: number) =>
      Math.max(...Array.from({ length: 200 }, () => backoffDelayMs(attempt)));
    expect(maxOfMany(3)).toBeGreaterThan(maxOfMany(0));
  });
});

describe("parseRetryAfterMs", () => {
  it("parses a numeric seconds value into milliseconds", () => {
    expect(parseRetryAfterMs("5")).toBe(5000);
  });

  it("returns undefined for null (header absent)", () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });

  it("returns undefined for a non-numeric value rather than guessing", () => {
    expect(parseRetryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT")).toBeUndefined();
  });

  it("returns undefined for a negative value", () => {
    expect(parseRetryAfterMs("-1")).toBeUndefined();
  });

  it("accepts zero", () => {
    expect(parseRetryAfterMs("0")).toBe(0);
  });

  it("clamps an absurd value instead of stalling indefinitely (found in review)", () => {
    // A misconfigured/malicious server sending Retry-After: 86400 (a full day) must not be able
    // to stall a request for that long with nothing bounding it.
    expect(parseRetryAfterMs("86400")).toBe(60_000);
  });

  it("still respects a legitimate value under the cap", () => {
    expect(parseRetryAfterMs("30")).toBe(30_000);
  });
});
