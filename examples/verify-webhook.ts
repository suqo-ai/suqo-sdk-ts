/**
 * Verify an inbound webhook delivery's signature.
 *
 * `webhooks.verify()` makes **no network call** and needs no key of its own — it only checks a
 * signature against a secret you already have. This script still constructs a `SuqoClient` (every
 * resource hangs off one shared client), but the sandbox key below is never actually sent anywhere
 * by this file.
 *
 * There's no way to trigger a real delivery from a script, so this builds a signed payload the
 * same way SUQO's backend does — HMAC-SHA256 over `${timestamp}.${rawBody}` — to demonstrate a
 * genuine delivery, a tampered one, and a stale one, all in one self-contained run.
 *
 * Run with a sandbox key — either inline, or via a .env file (see examples/README.md):
 *   SUQO_API_KEY=su_test_key_... npx tsx examples/verify-webhook.ts
 */
import "dotenv/config";
import { createHmac } from "node:crypto";
import { SuqoClient } from "@suqo/sdk";

const suqo = new SuqoClient({ apiKey: requireEnv("SUQO_API_KEY") });

const secret = "whsec_example_only_do_not_reuse";

function sign(rawBody: string, timestamp: string): string {
  const hex = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
  return `sha256=${hex}`;
}

// A checkout.succeeded delivery in the 2.0.0 shape — one per checkout session, keyed by
// session_id — see docs/user/webhooks.md. Event payloads stay snake_case on the wire, unlike every
// other model in this SDK.
const rawBody = JSON.stringify({
  event: "checkout.succeeded",
  session_id: "cks_3n9k2xQ7m",
  amount: "500.00", // decimal string — never a number, even in the raw wire payload
  status: "succeeded",
  items: [{ pbp_id: "pbp_3n9k2x" }],
});
const timestamp = String(Math.floor(Date.now() / 1000));

console.log(
  "Genuine delivery:",
  suqo.webhooks.verify({ rawBody, signature: sign(rawBody, timestamp), timestamp, secret }),
);
// → true

console.log(
  "Tampered body:   ",
  suqo.webhooks.verify({
    rawBody: rawBody.replace("500.00", "5.00"),
    signature: sign(rawBody, timestamp),
    timestamp,
    secret,
  }),
);
// → false — the signature was computed over the original amount

const staleTimestamp = String(Math.floor(Date.now() / 1000) - 600); // 10 minutes ago
console.log(
  "Stale (>5 min):  ",
  suqo.webhooks.verify({
    rawBody,
    signature: sign(rawBody, staleTimestamp),
    timestamp: staleTimestamp,
    secret,
  }),
);
// → false — older than the default 300s tolerance, even with a correct signature

// The real thing to remember: verify against the raw, unparsed body from the request, not a
// JSON.parse()'d-and-reserialized one — see docs/user/webhooks.md for why that trips people up.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `Missing required env var ${name} — set it to a sandbox key (su_test_key_...).`,
    );
  return value;
}
