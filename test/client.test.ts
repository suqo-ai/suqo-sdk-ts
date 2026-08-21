import { describe, expect, it } from "vitest";
import { SuqoClient } from "../src/client.js";
import { SuqoConfigError } from "../src/errors/SuqoError.js";

describe("SuqoClient", () => {
  it("resolves sandbox for a su_test_key_ key and never throws for a well-formed key", () => {
    const suqo = new SuqoClient({ apiKey: "su_test_key_abc123" });
    expect(suqo.environment).toBe("sandbox");
    expect(suqo.baseUrl).toBe("https://test.be.suqo.ai");
  });

  it("resolves live for a su_key_ key", () => {
    const suqo = new SuqoClient({ apiKey: "su_key_abc123" });
    expect(suqo.environment).toBe("live");
    expect(suqo.baseUrl).toBe("https://be.suqo.ai");
  });

  it("throws SuqoConfigError before any request on a malformed key", () => {
    expect(() => new SuqoClient({ apiKey: "not_a_suqo_key" })).toThrow(SuqoConfigError);
  });

  it("throws SuqoConfigError when baseUrl override disagrees with the key prefix", () => {
    expect(
      () => new SuqoClient({ apiKey: "su_test_key_abc123", baseUrl: "https://be.suqo.ai" }),
    ).toThrow(SuqoConfigError);
  });

  it("accepts a matching baseUrl override", () => {
    const suqo = new SuqoClient({
      apiKey: "su_test_key_abc123",
      baseUrl: "https://test.be.suqo.ai",
    });
    expect(suqo.baseUrl).toBe("https://test.be.suqo.ai");
  });

  it("defaults timeout to 30_000 and maxRetries to 2", () => {
    const suqo = new SuqoClient({ apiKey: "su_key_abc123" });
    expect(suqo.timeout).toBe(30_000);
    expect(suqo.maxRetries).toBe(2);
  });

  it("honors explicit timeout and maxRetries", () => {
    const suqo = new SuqoClient({ apiKey: "su_key_abc123", timeout: 5000, maxRetries: 5 });
    expect(suqo.timeout).toBe(5000);
    expect(suqo.maxRetries).toBe(5);
  });

  it("exposes no .products/.subscriptions/.customers/.webhooks yet — that's a later ticket", () => {
    const suqo = new SuqoClient({ apiKey: "su_key_abc123" });
    expect((suqo as unknown as Record<string, unknown>).products).toBeUndefined();
    expect((suqo as unknown as Record<string, unknown>).subscriptions).toBeUndefined();
  });

  it("the key never appears in JSON.stringify output", () => {
    const suqo = new SuqoClient({ apiKey: "su_key_super_secret_value" });
    const serialized = JSON.stringify(suqo);
    expect(serialized).not.toContain("su_key_super_secret_value");
    expect(JSON.parse(serialized)).toMatchObject({ apiKey: "[redacted]" });
  });

  it("the key never appears in a plain util.inspect/console.log-style rendering", () => {
    const suqo = new SuqoClient({ apiKey: "su_key_super_secret_value" });
    const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");
    const withInspect = suqo as unknown as Record<symbol, (() => unknown) | undefined>;
    const inspected = withInspect[inspectSymbol]?.call(suqo);
    expect(JSON.stringify(inspected)).not.toContain("su_key_super_secret_value");
  });

  it("the key is not an enumerable own property of the client either", () => {
    const suqo = new SuqoClient({ apiKey: "su_key_super_secret_value" });
    expect(Object.keys(suqo)).not.toContain("apiKey");
    for (const key in suqo) {
      expect(key).not.toBe("apiKey");
    }
  });
});
