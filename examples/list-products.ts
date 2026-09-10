/**
 * List the seller's product catalog.
 *
 * Products is the only resource that works before KYC verification, so this is usually the very
 * first real call an integration makes.
 *
 * Run with a sandbox key — either inline, or via a .env file (see examples/README.md):
 *   SUQO_API_KEY=su_test_key_... npx tsx examples/list-products.ts
 */
import "dotenv/config";
import { SuqoClient } from "@suqo/sdk";

const suqo = new SuqoClient({ apiKey: requireEnv("SUQO_API_KEY") });

const page = await suqo.products.list();

console.log(`${page.results.length} product(s) on this page (of ${page.count} total)\n`);

for (const product of page.results) {
  console.log(`${product.name}  —  ${product.productId}`);
  for (const plan of product.plan) {
    for (const period of plan.billingPeriods) {
      // price/currency stay strings end to end — never coerced to a number (SDK-SPEC.md §5).
      console.log(
        `  ${plan.planName} / ${period.label}: ${period.price} ${period.currency}  (pbpId: ${period.pbpId})`,
      );
    }
  }
}

if (page.results.length === 0) {
  console.log("No products yet — create one in the sandbox dashboard first.");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `Missing required env var ${name} — set it to a sandbox key (su_test_key_...).`,
    );
  return value;
}
