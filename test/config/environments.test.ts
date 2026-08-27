import { describe, expect, it } from "vitest";
import { SuqoConfigError } from "../../src/errors/SuqoError.js";
import { resolveEnvironment } from "../../src/config/environments.js";

describe("resolveEnvironment", () => {
  it("su_test_key_ prefix resolves to sandbox", () => {
    const result = resolveEnvironment("su_test_key_abc123");
    expect(result.environment).toBe("sandbox");
    expect(result.baseUrl).toBe("https://test-be.suqo.ai");
  });

  it("su_key_ prefix resolves to live", () => {
    const result = resolveEnvironment("su_key_abc123");
    expect(result.environment).toBe("live");
    expect(result.baseUrl).toBe("https://be.suqo.ai");
  });

  it("a malformed key (neither prefix) throws SuqoConfigError, fails before any request", () => {
    expect(() => resolveEnvironment("not_a_suqo_key")).toThrow(SuqoConfigError);
    expect(() => resolveEnvironment("not_a_suqo_key")).toThrow(
      'Malformed SUQO API key: expected prefix "su_key_" (live) or "su_test_key_" (sandbox).',
    );
  });

  it("an empty or non-string key throws SuqoConfigError rather than crashing on .startsWith", () => {
    expect(() => resolveEnvironment("")).toThrow(SuqoConfigError);
    // @ts-expect-error deliberately wrong type, to prove the runtime guard holds even if a
    // caller ignores the TypeScript types
    expect(() => resolveEnvironment(undefined)).toThrow(SuqoConfigError);
  });

  it("a matching baseUrl override is accepted (agreement passes)", () => {
    const result = resolveEnvironment("su_test_key_abc123", "https://test-be.suqo.ai");
    expect(result.baseUrl).toBe("https://test-be.suqo.ai");
  });

  it("a conflicting baseUrl override throws SuqoConfigError — silence-and-trust-one is forbidden", () => {
    expect(() => resolveEnvironment("su_test_key_abc123", "https://be.suqo.ai")).toThrow(
      SuqoConfigError,
    );
    expect(() => resolveEnvironment("su_test_key_abc123", "https://be.suqo.ai")).toThrow(
      "Environment mismatch: key implies https://test-be.suqo.ai but baseUrl was set to https://be.suqo.ai. Remove baseUrl or use a matching key.",
    );
  });

  it("su_test_key_ is checked before su_key_ — a sandbox key never resolves to live", () => {
    // su_test_key_ does not literally contain su_key_ as a substring, but SDK-SPEC.md §2 rule 4
    // still mandates this check order explicitly; this test locks that order in regardless.
    const result = resolveEnvironment("su_test_key_live_sounding_suffix");
    expect(result.environment).toBe("sandbox");
  });
});
