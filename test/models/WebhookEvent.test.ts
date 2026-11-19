import { describe, expect, it } from "vitest";
import type {
  ApiKeyCreatedEvent,
  ApiKeyDeletedEvent,
  CheckoutFailedEvent,
  CheckoutSucceededEvent,
  SubscriptionStatusChangedEvent,
  WebhookEvent,
} from "../../src/index.js";

// Delivery samples captured and shared by the backend team on 2026-11-19, copied key for key.
// Each is assigned to its SDK type, so `npm run typecheck` fails if a type drifts from the wire.

const catalogueSucceeded: CheckoutSucceededEvent = {
  event: "checkout.succeeded",
  session_id: "cks_fLVp0nhm2",
  amount: "1000.00",
  status: "succeeded",
  line_items: [
    {
      name: "Capture Pro",
      amount: "1000.00",
      pbp_id: "pbp_dd4876956363ad3",
      currency: "NPR",
      vat_type: null,
      image_urls: [],
      interval_type: "month",
      interval_count: 1,
      vat_percentage: null,
      discount_amount: null,
    },
  ],
};

const renewalSucceeded: CheckoutSucceededEvent = {
  ...catalogueSucceeded,
  line_items: [
    {
      name: "Capture Pro",
      amount: "1000.00",
      pbp_id: "pbp_dd4876956363ad3",
      currency: "NPR",
      vat_type: null,
      image_urls: [],
      interval_type: "month",
      interval_count: 1,
      vat_percentage: null,
      discount_amount: null,
      subscription_id: "e403e090-6bfb-4739-a6d7-0d4bd2ac69f5",
    },
  ],
};

const inlineFailed: CheckoutFailedEvent = {
  event: "checkout.failed",
  session_id: "cks_GupfbOumJ",
  amount: "500.00",
  status: "failed",
  line_items: [
    {
      name: "Capture Inline",
      amount: "500.00",
      pbp_id: null,
      currency: "NPR",
      vat_type: null,
      plan_name: null,
      interval_type: "month",
      interval_count: 1,
      vat_percentage: null,
      discount_amount: null,
    },
  ],
};

const statusChanged: SubscriptionStatusChangedEvent = {
  event: "subscription.status_changed",
  subscription_id: "e403e090-6bfb-4739-a6d7-0d4bd2ac69f5",
  previous_status: "pending_checkout",
  current_status: "active",
  changed_at: "2026-11-19T04:20:40.280231+00:00",
};

const apiKeyCreated: ApiKeyCreatedEvent = {
  event: "api_key.created",
  api_key_id: "99",
  name: "capture-main",
  masked_key: "su_key_719*************************d682",
  expires_at: null,
  created_at: "2026-11-19T04:20:39.878329+00:00",
};

const apiKeyDeleted: ApiKeyDeletedEvent = {
  event: "api_key.deleted",
  api_key_id: "101",
  name: "capture-expired",
  masked_key: "su_key_aa0*************************b08d",
  expires_at: "2026-11-19",
  created_at: "2026-11-19T04:20:39.978715+00:00",
  deleted_at: "2026-11-19T04:20:40.000798+00:00",
};

// The pre-fix shape (`items` with no `line_items`) must no longer type-check.
// @ts-expect-error — `items` is not the wire key; `line_items` is required.
const oldShape: CheckoutSucceededEvent = { event: "checkout.succeeded", session_id: "cks_1", amount: "1.00", status: "succeeded", items: [{ pbp_id: "pbp_1" }] };

describe("WebhookEvent types match the backend's captured deliveries", () => {
  const all: WebhookEvent[] = [catalogueSucceeded, renewalSucceeded, inlineFailed, statusChanged, apiKeyCreated, apiKeyDeleted];

  it("every sample narrows on `event`", () => {
    expect(all.map((e) => e.event)).toEqual([
      "checkout.succeeded",
      "checkout.succeeded",
      "checkout.failed",
      "subscription.status_changed",
      "api_key.created",
      "api_key.deleted",
    ]);
    expect(oldShape.event).toBe("checkout.succeeded");
  });

  it("a renewal's line item carries the subscription being renewed; a first payment's does not", () => {
    expect(renewalSucceeded.line_items[0]?.subscription_id).toBe("e403e090-6bfb-4739-a6d7-0d4bd2ac69f5");
    expect(catalogueSucceeded.line_items[0]).not.toHaveProperty("subscription_id");
  });

  it("amounts stay decimal strings", () => {
    expect(typeof inlineFailed.amount).toBe("string");
    expect(typeof inlineFailed.line_items[0]?.amount).toBe("string");
  });
});
