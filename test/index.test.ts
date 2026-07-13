import { describe, expect, it } from "vitest";
import { ApiError, Client } from "../src/index.js";

describe("Client", () => {
  it("throws when apiKey is missing", () => {
    // @ts-expect-error deliberately omitting apiKey
    expect(() => new Client({})).toThrow(ApiError);
  });

  it("constructs with an apiKey", () => {
    expect(new Client({ apiKey: "k" })).toBeInstanceOf(Client);
  });

  it("ApiError carries a status and is an Error", () => {
    const err = new ApiError("boom", 500);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(500);
  });
});
