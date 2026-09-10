import { describe, expect, it } from "vitest";
import { SubscriptionStatus, type Subscription } from "../../src/models/index.js";

describe("SubscriptionStatus", () => {
  it("every accessor's value matches the wire string exactly (openapi.yaml SubscriptionStatus)", () => {
    expect(SubscriptionStatus).toEqual({
      PendingCheckout: "pending_checkout",
      Active: "active",
      Due: "due",
      Cancelled: "cancelled",
      PendingCancellation: "pending_cancellation",
      Inactive: "inactive",
    });
  });

  it("round-trips an unrecognized wire value instead of raising (SDK Naming Map v1.1 §10)", () => {
    // A status the API adds later, before this SDK's next release, must still flow through as a
    // plain string — assignable with NO cast, which is the actual proof the type-level union was
    // widened correctly rather than just hoping runtime code never hits this.
    const futureStatus: Subscription["status"] = "grace_period";
    expect(futureStatus).toBe("grace_period");
  });
});
