/**
 * List the seller's customers, then retrieve one by id.
 *
 * Read-only example — `create()`/`update()` also exist (see docs/user/customers.md), but this
 * script doesn't write anything to your account. `Customer.id` is an opaque
 * prefixed string (e.g. `cus_1ce18d624`), the same convention as `pbp_...` on billing periods —
 * not a UUID, but not the exception it might look like at a glance either.
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
    `${customer.fullName ?? "(no name on file)"}  ${customer.buyerEmail ?? ""}  —  ${customer.id}`,
  );
}

const first = page.results[0];
if (first) {
  // retrieve() takes the same string id — fetch this one again to show the single-record shape.
  const fetched = await suqo.customers.retrieve(first.id);
  console.log(`\nRetrieved ${fetched.id} directly:`, fetched);
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
