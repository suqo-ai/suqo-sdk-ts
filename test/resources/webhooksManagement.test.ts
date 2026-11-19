import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../../src/http/HttpClient.js";
import { SdkConfig } from "../../src/config/SdkConfig.js";
import { deserializeWebhook, WebhooksResource } from "../../src/resources/webhooks.js";
import { PermissionDeniedError, SuqoConfigError, ValidationError } from "../../src/errors/SuqoError.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function webhooks(): WebhooksResource {
  const config = new SdkConfig({ apiKey: "su_test_key_abc123" });
  const http = new HttpClient(config, { sleep: async () => {} });
  return new WebhooksResource(http);
}

const wireWebhook = {
  id: "whk_test0001",
  event: "checkout.succeeded",
  endpoint_url: "https://partner.example.com/hooks/suqo",
  is_active: true,
  created_at: "2026-07-03T10:15:00Z",
};

const webhook = {
  id: "whk_test0001",
  event: "checkout.succeeded",
  endpointUrl: "https://partner.example.com/hooks/suqo",
  isActive: true,
  createdAt: "2026-07-03T10:15:00Z",
};

const BASE = "https://test-be.suqo.ai/api/v1/webhooks";

function lastCall(): { url: string; method: string | undefined; body: unknown } {
  const [url, init] = vi.mocked(fetch).mock.calls.at(-1)!;
  return { url: url as string, method: init?.method, body: init?.body === undefined ? undefined : JSON.parse(init.body as string) };
}

describe("deserializeWebhook", () => {
  it("maps a registration to camelCase", () => {
    expect(deserializeWebhook(wireWebhook)).toEqual(webhook);
  });

  it("passes an event the SDK doesn't know yet through untouched (round-trip, Naming Map §9)", () => {
    expect(deserializeWebhook({ ...wireWebhook, event: "payout.sent" }).event).toBe("payout.sent");
  });
});

describe("WebhooksResource management", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("list() GETs /api/v1/webhooks/ and maps the plain (unpaginated) array", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([wireWebhook]));

    await expect(webhooks().list()).resolves.toEqual([webhook]);
    expect(lastCall()).toMatchObject({ url: `${BASE}/`, method: "GET" });
  });

  it("create() POSTs event/endpoint_url/is_active in wire names", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(wireWebhook, 201));

    await expect(
      webhooks().create({ event: "checkout.succeeded", endpointUrl: "https://partner.example.com/hooks/suqo", isActive: true }),
    ).resolves.toEqual(webhook);
    expect(lastCall()).toEqual({
      url: `${BASE}/`,
      method: "POST",
      body: { event: "checkout.succeeded", endpoint_url: "https://partner.example.com/hooks/suqo", is_active: true },
    });
  });

  it("create() surfaces the one-webhook-per-event 400 as ValidationError, and never retries", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ event: ["A webhook for this event already exists."] }, 400));

    const err = await webhooks()
      .create({ event: "checkout.succeeded", endpointUrl: "https://partner.example.com/hooks/suqo" })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retrieve(id) GETs /api/v1/webhooks/{id}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(wireWebhook));

    await expect(webhooks().retrieve("whk_test0001")).resolves.toEqual(webhook);
    expect(lastCall()).toMatchObject({ url: `${BASE}/whk_test0001/`, method: "GET" });
  });

  it("replace(id) PUTs the full representation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(wireWebhook));

    await webhooks().replace("whk_test0001", { event: "checkout.failed", endpointUrl: "https://partner.example.com/h" });
    expect(lastCall()).toEqual({
      url: `${BASE}/whk_test0001/`,
      method: "PUT",
      body: { event: "checkout.failed", endpoint_url: "https://partner.example.com/h" },
    });
  });

  it("update(id) PATCHes only the given fields — { isActive: false } pauses deliveries", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ...wireWebhook, is_active: false }));

    const result = await webhooks().update("whk_test0001", { isActive: false });
    expect(lastCall()).toEqual({ url: `${BASE}/whk_test0001/`, method: "PATCH", body: { is_active: false } });
    expect(result.isActive).toBe(false);
  });

  it("delete(id) sends DELETE and resolves to undefined on the empty 204", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(webhooks().delete("whk_test0001")).resolves.toBeUndefined();
    expect(lastCall()).toEqual({ url: `${BASE}/whk_test0001/`, method: "DELETE", body: undefined });
  });

  it("retrieveSecret() GETs /api/v1/webhooks/secret/ and returns { signingSecret }", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ signing_secret: "whsec_test" }));

    await expect(webhooks().retrieveSecret()).resolves.toEqual({ signingSecret: "whsec_test" });
    expect(lastCall()).toMatchObject({ url: `${BASE}/secret/`, method: "GET" });
  });

  it("testDelivery(id) POSTs to /api/v1/webhooks/{id}/test-delivery/ and resolves once queued (202)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ detail: "Test webhook enqueued." }, 202));

    await expect(webhooks().testDelivery("whk_test0001")).resolves.toBeUndefined();
    expect(lastCall()).toMatchObject({ url: `${BASE}/whk_test0001/test-delivery/`, method: "POST" });
  });

  it("a non-KYC 403 surfaces as PermissionDeniedError", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "You do not have permission to perform this action." }, 403),
    );

    await expect(webhooks().list()).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it.each([
    ["retrieve", (w: WebhooksResource, id: string) => w.retrieve(id)],
    ["replace", (w: WebhooksResource, id: string) => w.replace(id, { event: "checkout.failed", endpointUrl: "https://x.example" })],
    ["update", (w: WebhooksResource, id: string) => w.update(id, { isActive: false })],
    ["delete", (w: WebhooksResource, id: string) => w.delete(id)],
    ["testDelivery", (w: WebhooksResource, id: string) => w.testDelivery(id)],
  ] as const)("%s() rejects an empty, \".\" or \"..\" id before any request", async (_name, call) => {
    for (const id of ["", ".", ".."]) {
      await expect(call(webhooks(), id)).rejects.toBeInstanceOf(SuqoConfigError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["retrieve", (w: WebhooksResource) => w.retrieve("secret")],
    ["update", (w: WebhooksResource) => w.update("secret", { isActive: false })],
    ["delete", (w: WebhooksResource) => w.delete("secret")],
  ] as const)("%s(\"secret\") is rejected before any request — it would hit GET /webhooks/secret/ (found in review)", async (_name, call) => {
    await expect(call(webhooks())).rejects.toBeInstanceOf(SuqoConfigError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a webhook read back can be written back as-is, including an event this SDK doesn't know yet (found in review)", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ ...wireWebhook, event: "payout.sent" }))
      .mockResolvedValueOnce(jsonResponse({ ...wireWebhook, event: "payout.sent" }));

    const w = await webhooks().retrieve("whk_test0001");
    // Compiles because write params accept the same loose event type the read side returns.
    await webhooks().replace(w.id, { event: w.event, endpointUrl: w.endpointUrl });

    expect(lastCall().body).toEqual({ event: "payout.sent", endpoint_url: "https://partner.example.com/hooks/suqo" });
  });
});
