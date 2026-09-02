/**
 * End-to-end: list products, create a subscription for a real one, then verify a sample
 * checkout.succeeded webhook for it — the shape of a real integration, not three isolated calls.
 *
 * Run with a sandbox key:
 *   SUQO_API_KEY=su_test_key_... npx tsx examples/quickstart.ts
 */
import { createHmac } from "node:crypto";
import { SuqoClient } from "@suqo/sdk";

const suqo = new SuqoClient({ apiKey: requireEnv("SUQO_API_KEY") });

// 1. List products, pick the first available billing period to subscribe to.
const products = await suqo.products.list();
const billingPeriod = products.results[0]?.plan[0]?.billingPeriods[0];
if (!billingPeriod) {
  throw new Error(
    "No billing period available — create a product with a plan in the sandbox first.",
  );
}
console.log(
  `Subscribing to pbpId ${billingPeriod.pbpId} (${billingPeriod.price} ${billingPeriod.currency})`,
);

// 2. Create the subscription. It comes back in "pending_checkout" — checkoutUrl is where the
// buyer pays, not proof they did.
const subscription = await suqo.subscriptions.create({
  pbpId: billingPeriod.pbpId,
  returnUrl: "https://your-app.example/return",
  customer: {
    phone: "9800000000",
    fullName: "Jane Doe",
    email: "jane@example.com",
    address: "Kathmandu",
  },
});
console.log(
  `Created ${subscription.subscriptionId} — redirect the buyer to ${subscription.checkoutUrl}`,
);

// 3. In production, you'd learn whether the buyer actually paid from a real checkout.succeeded /
// checkout.failed webhook delivery, not from step 2's response. There's no way to trigger a real
// delivery from a script, so this signs a sample payload the same way SUQO's backend does, tied to
// the subscription just created, to show what handling that webhook looks like end to end.
const secret = "whsec_example_only_do_not_reuse";
const timestamp = String(Math.floor(Date.now() / 1000));
const rawBody = JSON.stringify({
  event: "checkout.succeeded",
  subscription_id: subscription.subscriptionId,
  amount: billingPeriod.price,
  status: "succeeded",
});
const signature = `sha256=${createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex")}`;

const verified = suqo.webhooks.verify({ rawBody, signature, timestamp, secret });
console.log(`Sample checkout.succeeded webhook verified: ${verified}`);

if (verified) {
  const event = JSON.parse(rawBody) as { subscription_id: string; amount: string };
  console.log(`→ Would now mark ${event.subscription_id} as paid (amount: ${event.amount}).`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `Missing required env var ${name} — set it to a sandbox key (su_test_key_...).`,
    );
  return value;
}
