import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.js";

describe("public export surface", () => {
  it("exports the version", () => {
    expect(sdk.VERSION).toBe("0.0.1");
  });

  // The SuqoError hierarchy, SdkConfig, and SuqoClient are smoke-tested here again once
  // this ticket's remaining commits land (see docs/implementation-plan.md Ticket 1).
});
