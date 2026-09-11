import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.js";
import packageJson from "../package.json";

describe("public export surface", () => {
  it("exports the version, kept in sync with package.json (found in review: this used to assert a hardcoded literal that silently drifted from the real version)", () => {
    expect(sdk.VERSION).toBe(packageJson.version);
  });

  it("exports the full SuqoError hierarchy and mapHttpError", () => {
    expect(sdk.SuqoError).toBeTypeOf("function");
    expect(sdk.SuqoConfigError).toBeTypeOf("function");
    expect(sdk.AuthenticationError).toBeTypeOf("function");
    expect(sdk.KycRequiredError).toBeTypeOf("function");
    expect(sdk.ValidationError).toBeTypeOf("function");
    expect(sdk.NotFoundError).toBeTypeOf("function");
    expect(sdk.RateLimitError).toBeTypeOf("function");
    expect(sdk.ServerError).toBeTypeOf("function");
    expect(sdk.NetworkError).toBeTypeOf("function");
    expect(sdk.mapHttpError).toBeTypeOf("function");
  });

  it("exports SuqoClient, constructible end-to-end from the public surface", () => {
    expect(sdk.SuqoClient).toBeTypeOf("function");
    const suqo = new sdk.SuqoClient({ apiKey: "su_test_key_abc123" });
    expect(suqo.environment).toBe("sandbox");
    expect(suqo.baseUrl).toBe("https://test-be.suqo.ai");
  });

  it("attaches .products/.subscriptions/.customers/.webhooks onto the client built from the public surface", () => {
    const suqo = new sdk.SuqoClient({ apiKey: "su_test_key_abc123" });
    expect(suqo.products).toBeDefined();
    expect(suqo.subscriptions).toBeDefined();
    expect(suqo.customers).toBeDefined();
    expect(suqo.webhooks).toBeDefined();
    expect(suqo.webhooks.verify).toBeTypeOf("function");
  });

  it("exports the pagination runtime helpers", () => {
    expect(sdk.toPageQuery).toBeTypeOf("function");
    expect(sdk.listAll).toBeTypeOf("function");
    expect(sdk.bridgeAutoPaging).toBeTypeOf("function");
    expect(sdk.deserializePage).toBeTypeOf("function");
  });

  it("exports SubscriptionStatus with every wire value", () => {
    expect(sdk.SubscriptionStatus.Active).toBe("active");
    expect(sdk.SubscriptionStatus.PendingCheckout).toBe("pending_checkout");
  });
});
