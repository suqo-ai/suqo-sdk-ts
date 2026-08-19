import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.js";

describe("public export surface", () => {
  it("exports the version", () => {
    expect(sdk.VERSION).toBe("0.0.1");
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
    expect(suqo.baseUrl).toBe("https://test.be.suqo.ai");
  });
});
