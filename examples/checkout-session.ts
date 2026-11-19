/**
 * Open a checkout session — the recommended way to collect payment — then read it back.
 *
 * Not read-only: this opens a real checkout session on your account. Nothing is charged until a
 * buyer actually pays at `checkoutUrl`, and an unpaid session simply expires (about 30 minutes).
 * No customer is passed, so the buyer would enter their own details at checkout — nothing is sent
 * to anyone by running this.
 *
 * `checkoutSessions.create()` is the API's one rate-limited endpoint (20 sessions a minute per
 * account) and, like every write, is never retried automatically (SDK-SPEC.md §8, §12).
 *
 * Run with a sandbox key — either inline, or via a .env file (see examples/README.md):
 *   SUQO_API_KEY=su_test_key_... npx tsx examples/checkout-session.ts
 */
import "dotenv/config";
import { RateLimitError, SuqoClient } from "@suqo/sdk";

const suqo = new SuqoClient({ apiKey: requireEnv("SUQO_API_KEY") });

// 1. Pick a catalogue item to charge: any billing period's pbpId from products.list().
const products = await suqo.products.list();
const billingPeriod = products.results[0]?.plan[0]?.billingPeriods[0];
if (!billingPeriod) {
  throw new Error(
    "No billing period available — create a product with a plan in the sandbox first.",
  );
}

// 2. Open the session. Items are either a catalogue item ({ pbpId }) or a partner-priced one
// ({ name, amount, intervalType, intervalCount }) — never a mix within one item.
try {
  const session = await suqo.checkoutSessions.create({
    returnUrl: "https://your-app.example/orders/1234",
    items: [{ pbpId: billingPeriod.pbpId }],
  });

  // Send the buyer here. The return to returnUrl is NOT proof of payment — the outcome arrives
  // on checkout.succeeded / checkout.failed, whose session_id is this publicId.
  console.log(`Opened ${session.publicId} — send the buyer to ${session.checkoutUrl}`);
  console.log(`It stops working at ${session.expiresAt}.`);

  // 3. Read it back while it's open. Once paid or expired this throws NotFoundError.
  const open = await suqo.checkoutSessions.retrieve(session.publicId);
  for (const item of open.lineItems) {
    // amount stays a string end to end — never coerced to a number (SDK-SPEC.md §5).
    console.log(`  ${item.name}: ${item.amount} ${item.currency} (${item.displayLabel})`);
  }
} catch (err) {
  if (err instanceof RateLimitError) {
    console.log(`Rate limited — try again in ${(err.retryAfter ?? 60_000) / 1000}s.`);
  } else {
    throw err;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `Missing required env var ${name} — set it to a sandbox key (su_test_key_...).`,
    );
  return value;
}
