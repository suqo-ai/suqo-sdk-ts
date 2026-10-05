/**
 * End-to-end: list products, open a checkout session for a real one, then verify a sample
 * checkout.succeeded webhook for it — the shape of a real integration, not three isolated calls.
 *
 * Checkout sessions are the recommended way to collect payment. The older one-subscription flow,
 * `subscriptions.create()`, is still supported — see `subscriptions.ts`.
 *
 * Run with a sandbox key — either inline, or via a .env file (see examples/README.md):
 *   SUQO_API_KEY=su_test_key_... npx tsx examples/quickstart.ts
 */
import "dotenv/config";
import { createHmac } from "node:crypto";
import { SuqoClient, type CheckoutSucceededEvent } from "@suqo/sdk";

const suqo = new SuqoClient({ apiKey: requireEnv("SUQO_API_KEY") });

// 1. List products, pick the first available billing period to charge.
const products = await suqo.products.list();
const billingPeriod = products.results[0]?.plan[0]?.billingPeriods[0];
if (!billingPeriod) {
  throw new Error(
    "No billing period available — create a product with a plan in the sandbox first.",
  );
}
console.log(
  `Charging pbpId ${billingPeriod.pbpId} (${billingPeriod.price} ${billingPeriod.currency})`,
);

// 2. Open a checkout session. No customerId, so the buyer enters their own details at checkout —
// running this sends nothing to anyone. checkoutUrl is where the buyer pays, not proof they did.
const session = await suqo.checkoutSessions.create({
  returnUrl: "https://your-app.example/return",
  items: [{ pbpId: billingPeriod.pbpId }],
});
console.log(`Opened ${session.publicId} — redirect the buyer to ${session.checkoutUrl}`);

// 3. In production, you'd learn whether the buyer actually paid from a real checkout.succeeded /
// checkout.failed webhook delivery, not from step 2's response. There's no way to trigger a real
// delivery from a script, so this signs a sample payload the same way SUQO's backend does, tied to
// the session just opened (session_id is its publicId), to show what handling that webhook looks
// like end to end.
const secret = "whsec_example_only_do_not_reuse";
const timestamp = String(Math.floor(Date.now() / 1000));
const rawBody = JSON.stringify({
  event: "checkout.succeeded",
  session_id: session.publicId,
  amount: billingPeriod.price,
  status: "succeeded",
  items: [{ pbp_id: billingPeriod.pbpId }],
});
const signature = `sha256=${createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex")}`;

const verified = suqo.webhooks.verify({ rawBody, signature, timestamp, secret });
console.log(`Sample checkout.succeeded webhook verified: ${verified}`);

if (verified) {
  const event = JSON.parse(rawBody) as CheckoutSucceededEvent;
  console.log(`→ Would now mark ${event.session_id} as paid (amount: ${event.amount}).`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `Missing required env var ${name} — set it to a sandbox key (su_test_key_...).`,
    );
  return value;
}
