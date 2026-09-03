/**
 * List the seller's customers, then retrieve one by id.
 *
 * Read-only — there's no create/update/delete on this resource. Unlike every other resource in
 * the SDK, `Customer.id` is an integer, not a UUID.
 *
 * Run with a sandbox key — either inline, or via a .env file (see examples/README.md):
 *   SUQO_API_KEY=su_test_key_... npx tsx examples/list-customers.ts
 */
import "dotenv/config";
import { SuqoClient } from "@suqo/sdk";

const suqo = new SuqoClient({ apiKey: requireEnv("SUQO_API_KEY") });

const page = await suqo.customers.list();

console.log(`${page.results.length} customer(s) on this page (of ${page.count} total)\n`);

for (const customer of page.results) {
  console.log(
    `#${customer.id}  ${customer.fullName ?? "(no name on file)"}  ${customer.buyerEmail ?? ""}`,
  );
}

const first = page.results[0];
if (first) {
  // retrieve() takes the same integer id — fetch this one again to show the single-record shape.
  const fetched = await suqo.customers.retrieve(first.id);
  console.log(`\nRetrieved #${fetched.id} directly:`, fetched);
} else {
  console.log("\nNo customers yet — one is created the first time a buyer completes checkout.");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `Missing required env var ${name} — set it to a sandbox key (su_test_key_...).`,
    );
  return value;
}
