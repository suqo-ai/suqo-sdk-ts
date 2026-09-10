import { describe, expect, it } from "vitest";
import { SuqoConfigError } from "../../src/errors/SuqoError.js";
import { SdkConfig } from "../../src/config/SdkConfig.js";

describe("SdkConfig", () => {
  it("resolves sandbox for a su_test_key_ key and never throws for a well-formed key", () => {
    const config = new SdkConfig({ apiKey: "su_test_key_abc123" });
    expect(config.environment).toBe("sandbox");
    expect(config.baseUrl).toBe("https://test-be.suqo.ai");
  });

  it("resolves live for a su_key_ key", () => {
    const config = new SdkConfig({ apiKey: "su_key_abc123" });
    expect(config.environment).toBe("live");
    expect(config.baseUrl).toBe("https://be.suqo.ai");
  });

  it("throws SuqoConfigError for a malformed key", () => {
    expect(() => new SdkConfig({ apiKey: "not_a_suqo_key" })).toThrow(SuqoConfigError);
  });

  it("throws SuqoConfigError when baseUrl override disagrees with the key prefix", () => {
    expect(
      () => new SdkConfig({ apiKey: "su_test_key_abc123", baseUrl: "https://be.suqo.ai" }),
    ).toThrow(SuqoConfigError);
  });

  it("accepts a matching baseUrl override", () => {
    const config = new SdkConfig({
      apiKey: "su_test_key_abc123",
      baseUrl: "https://test-be.suqo.ai",
    });
    expect(config.baseUrl).toBe("https://test-be.suqo.ai");
  });

  it("defaults timeout to 30_000 and maxRetries to 2", () => {
    const config = new SdkConfig({ apiKey: "su_key_abc123" });
    expect(config.timeout).toBe(30_000);
    expect(config.maxRetries).toBe(2);
  });

  it("honors explicit timeout, maxRetries, and dispatcher", () => {
    const dispatcher = { custom: true };
    const config = new SdkConfig({
      apiKey: "su_key_abc123",
      timeout: 5000,
      maxRetries: 5,
      dispatcher,
    });
    expect(config.timeout).toBe(5000);
    expect(config.maxRetries).toBe(5);
    expect(config.dispatcher).toBe(dispatcher);
  });

  it("exposes the raw apiKey only through the getter, for http.ts to build the Bearer header", () => {
    const config = new SdkConfig({ apiKey: "su_key_abc123" });
    expect(config.apiKey).toBe("su_key_abc123");
  });

  it("the key never appears in JSON.stringify output", () => {
    const config = new SdkConfig({ apiKey: "su_key_super_secret_value" });
    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain("su_key_super_secret_value");
    expect(JSON.parse(serialized)).toMatchObject({ apiKey: "[redacted]" });
  });

  it("the key never appears in a plain util.inspect/console.log-style rendering", () => {
    const config = new SdkConfig({ apiKey: "su_key_super_secret_value" });
    // Node's console.log/util.inspect invoke the well-known custom-inspect symbol when present —
    // simulate that directly rather than depending on a specific Node util import.
    const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");
    const withInspect = config as unknown as Record<symbol, (() => unknown) | undefined>;
    const inspected = withInspect[inspectSymbol]?.call(config);
    expect(JSON.stringify(inspected)).not.toContain("su_key_super_secret_value");
  });

  it("the key is not an enumerable own property, so Object.keys/for..in never surface it", () => {
    const config = new SdkConfig({ apiKey: "su_key_super_secret_value" });
    expect(Object.keys(config)).not.toContain("apiKey");
    for (const key in config) {
      expect(key).not.toBe("apiKey");
    }
  });
});
