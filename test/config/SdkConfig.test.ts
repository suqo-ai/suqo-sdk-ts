import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/errors/index.js";
import { DEFAULT_BASE_URLS, SdkConfig } from "../../src/config/index.js";

describe("SdkConfig", () => {
  it.each(["production", "staging", "local"] as const)(
    "resolves the default baseUrl for %s",
    (environment) => {
      const config = new SdkConfig({ environment });
      expect(config.environment).toBe(environment);
      expect(config.baseUrl).toBe(DEFAULT_BASE_URLS[environment]);
    },
  );

  it("__unsafeBaseUrlOverride wins over the environment default", () => {
    const config = new SdkConfig({
      environment: "production",
      __unsafeBaseUrlOverride: "http://localhost:9999",
    });
    expect(config.baseUrl).toBe("http://localhost:9999");
  });

  it("fails fast with a ValidationError on an invalid environment", () => {
    // @ts-expect-error deliberately invalid environment
    expect(() => new SdkConfig({ environment: "prod" })).toThrow(ValidationError);
  });

  it("fails fast with a ValidationError on a malformed override URL", () => {
    let caught: unknown;
    try {
      new SdkConfig({ environment: "local", __unsafeBaseUrlOverride: "not-a-url" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).issues).toEqual([
      expect.objectContaining({ path: "__unsafeBaseUrlOverride" }),
    ]);
  });

  it("never accepts a raw baseUrl field — the unknown key is silently ignored, not honored as an override", () => {
    const config = new SdkConfig({
      environment: "production",
      // @ts-expect-error `baseUrl` is not part of the public configuration API
      baseUrl: "https://evil.example.com",
    });
    expect(config.baseUrl).toBe(DEFAULT_BASE_URLS.production);
  });
});
