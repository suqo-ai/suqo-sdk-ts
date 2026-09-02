/**
 * The subscription lifecycle: create, list, cancel, change the billing date, and resume.
 *
 * Only `create()` is safe to run unconditionally against a fresh sandbox — `cancel()`,
 * `updateBillingCycle()`, and `resume()` each need a subscription in a particular state (an
 * active one to cancel, a cancelled one to resume, and so on), so this script creates one, then
 * shows the other three as complete, working functions you call once you have a subscription id
 * in the right state — see the notes in `main()` at the bottom.
 *
 * None of `create`/`cancel`/`updateBillingCycle`/`resume` are automatically retried on failure —
 * writes never retry until idempotency ships (SDK-SPEC.md §8, §12).
 *
 * Run with a sandbox key:
 *   SUQO_API_KEY=su_test_key_... npx tsx examples/subscriptions.ts
 */
import { SuqoClient, type CreateSubscriptionResponse } from "@suqo/sdk";

const suqo = new SuqoClient({ apiKey: requireEnv("SUQO_API_KEY") });

// Exported (not just declared) even though this script only calls createSubscription() below —
// each one is a genuine, complete function you can copy out and call directly once you have a
// subscription id in the right state, same as the other resource examples in this directory.

/** Creates a subscription and returns the checkout URL to redirect the buyer to. */
export async function createSubscription(pbpId: string): Promise<CreateSubscriptionResponse> {
  const response = await suqo.subscriptions.create({
    pbpId,
    returnUrl: "https://your-app.example/return",
    customer: {
      phone: "9800000000",
      fullName: "Jane Doe",
      email: "jane@example.com",
      address: "Kathmandu",
    },
  });

  // checkoutUrl is not proof of payment — learn the real outcome from the checkout.succeeded /
  // checkout.failed webhooks (see examples/verify-webhook.ts), not from this response.
  console.log(
    `Created ${response.subscriptionId} in ${response.status} — checkout: ${response.checkoutUrl}`,
  );
  return response;
}

/** Schedules cancellation for the end of the current billing period — not immediate. */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const result = await suqo.subscriptions.cancel(subscriptionId);
  console.log(result.message);
}

/** Sets a subscription's next billing date. `nextBillingCycle` is YYYY-MM-DD, today or later. */
export async function updateBillingCycle(
  subscriptionId: string,
  nextBillingCycle: string,
): Promise<void> {
  const result = await suqo.subscriptions.updateBillingCycle({ subscriptionId, nextBillingCycle });
  console.log(result.message);
}

/** Resumes a subscription. */
export async function resumeSubscription(subscriptionId: string): Promise<void> {
  const result = await suqo.subscriptions.resume(subscriptionId);
  console.log(result.message);
}

async function main(): Promise<void> {
  const page = await suqo.products.list();
  const billingPeriod = page.results[0]?.plan[0]?.billingPeriods[0];
  if (!billingPeriod) {
    throw new Error(
      "No billing period available — create a product with a plan in the sandbox first.",
    );
  }

  const created = await createSubscription(billingPeriod.pbpId);

  console.log(`
A freshly created subscription is in "${created.status}" — the buyer hasn't paid yet, so cancel()/
resume()/updateBillingCycle() aren't demonstrated against it here (each expects a different real
state). Once you have a subscription id in the right state, call any of the functions above
directly, e.g.:

  await cancelSubscription("${created.subscriptionId}");
  await updateBillingCycle("${created.subscriptionId}", "2026-03-01");
  await resumeSubscription("${created.subscriptionId}");
`);
}

await main();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `Missing required env var ${name} — set it to a sandbox key (su_test_key_...).`,
    );
  return value;
}
