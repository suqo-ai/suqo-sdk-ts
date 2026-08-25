import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WebhooksResource } from "../../src/resources/webhooks.js";

const SECRET = "whsec_test_secret";

/** Builds a genuinely valid signature/timestamp pair for a given body, the same way SUQO would. */
function sign(body: string | Buffer, timestamp: string, secret = SECRET): string {
  const hex = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
  return `sha256=${hex}`;
}

function nowSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

function webhooks(): WebhooksResource {
  return new WebhooksResource();
}

describe("WebhooksResource.verify", () => {
  it("a genuinely valid signature verifies as true", () => {
    const rawBody = JSON.stringify({ event: "checkout.succeeded" });
    const timestamp = nowSeconds();
    const signature = sign(rawBody, timestamp);

    expect(webhooks().verify({ rawBody, signature, timestamp, secret: SECRET })).toBe(true);
  });

  it("a tampered body fails verification", () => {
    const timestamp = nowSeconds();
    const signature = sign(JSON.stringify({ event: "checkout.succeeded" }), timestamp);
    const tamperedBody = JSON.stringify({ event: "checkout.succeeded", amount: "999999.00" });

    expect(webhooks().verify({ rawBody: tamperedBody, signature, timestamp, secret: SECRET })).toBe(false);
  });

  it("a stale timestamp (beyond toleranceSec) fails verification", () => {
    const rawBody = JSON.stringify({ event: "checkout.succeeded" });
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 600); // 10 minutes ago
    const signature = sign(rawBody, staleTimestamp);

    expect(
      webhooks().verify({ rawBody, signature, timestamp: staleTimestamp, secret: SECRET, toleranceSec: 300 }),
    ).toBe(false);
  });

  it("a timestamp within a custom, wider toleranceSec still verifies", () => {
    const rawBody = JSON.stringify({ event: "checkout.succeeded" });
    const timestamp = String(Math.floor(Date.now() / 1000) - 600);
    const signature = sign(rawBody, timestamp);

    expect(
      webhooks().verify({ rawBody, signature, timestamp, secret: SECRET, toleranceSec: 3600 }),
    ).toBe(true);
  });

  it("the parsed-then-reserialized-body trap: re-stringified JSON fails, proving byte-sensitivity", () => {
    // The exact bug SDK-SPEC.md §9 warns about: JSON.parse + JSON.stringify can silently change
    // whitespace/key order even though the *meaning* is identical -- the signature must still fail.
    const originalBody = '{"event":"checkout.succeeded",  "amount": "1500.00"}'; // deliberately odd spacing
    const timestamp = nowSeconds();
    const signature = sign(originalBody, timestamp);

    const reserialized = JSON.stringify(JSON.parse(originalBody));
    expect(reserialized).not.toBe(originalBody); // sanity: the round-trip really did change the bytes

    expect(webhooks().verify({ rawBody: reserialized, signature, timestamp, secret: SECRET })).toBe(false);
    // The original, untouched bytes still verify correctly.
    expect(webhooks().verify({ rawBody: originalBody, signature, timestamp, secret: SECRET })).toBe(true);
  });

  it("the wrong secret fails verification", () => {
    const rawBody = JSON.stringify({ event: "checkout.succeeded" });
    const timestamp = nowSeconds();
    const signature = sign(rawBody, timestamp, SECRET);

    expect(webhooks().verify({ rawBody, signature, timestamp, secret: "whsec_wrong_secret" })).toBe(false);
  });

  it("a signature missing the sha256= prefix fails, never crashes", () => {
    const rawBody = JSON.stringify({ event: "checkout.succeeded" });
    const timestamp = nowSeconds();
    const bareHex = sign(rawBody, timestamp).replace("sha256=", "");

    expect(webhooks().verify({ rawBody, signature: bareHex, timestamp, secret: SECRET })).toBe(false);
  });

  it("a signature containing invalid hex characters fails rather than being silently truncated", () => {
    const rawBody = JSON.stringify({ event: "checkout.succeeded" });
    const timestamp = nowSeconds();

    expect(
      webhooks().verify({ rawBody, signature: "sha256=not-valid-hex!!", timestamp, secret: SECRET }),
    ).toBe(false);
  });

  it("an empty timestamp fails rather than being treated as epoch 0", () => {
    const rawBody = JSON.stringify({ event: "checkout.succeeded" });
    expect(webhooks().verify({ rawBody, signature: "sha256=" + "a".repeat(64), timestamp: "", secret: SECRET })).toBe(
      false,
    );
  });

  it("a non-numeric timestamp fails rather than throwing", () => {
    const rawBody = JSON.stringify({ event: "checkout.succeeded" });
    expect(
      webhooks().verify({
        rawBody,
        signature: "sha256=" + "a".repeat(64),
        timestamp: "not-a-number",
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("accepts a Buffer for rawBody, verifying identically to the equivalent string", () => {
    const bodyString = JSON.stringify({ event: "checkout.succeeded" });
    const bodyBuffer = Buffer.from(bodyString, "utf8");
    const timestamp = nowSeconds();
    const signature = sign(bodyBuffer, timestamp);

    expect(webhooks().verify({ rawBody: bodyBuffer, signature, timestamp, secret: SECRET })).toBe(true);
    expect(webhooks().verify({ rawBody: bodyString, signature, timestamp, secret: SECRET })).toBe(true);
  });
});
