import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.js";

describe("public export surface", () => {
  it("exports the version", () => {
    expect(sdk.VERSION).toBe("0.0.1");
  });

  it("exports SdkConfig and the environment list", () => {
    expect(sdk.SdkConfig).toBeTypeOf("function");
    expect(sdk.SUQO_ENVIRONMENTS).toEqual(["production", "staging", "local"]);
  });

  it("exports the full SDKError hierarchy and mapHttpError", () => {
    expect(sdk.SDKError).toBeTypeOf("function");
    expect(sdk.AuthenticationError).toBeTypeOf("function");
    expect(sdk.PermissionError).toBeTypeOf("function");
    expect(sdk.ValidationError).toBeTypeOf("function");
    expect(sdk.NotFoundError).toBeTypeOf("function");
    expect(sdk.RateLimitError).toBeTypeOf("function");
    expect(sdk.ServerError).toBeTypeOf("function");
    expect(sdk.NetworkError).toBeTypeOf("function");
    expect(sdk.TimeoutError).toBeTypeOf("function");
    expect(sdk.mapHttpError).toBeTypeOf("function");
  });
});
