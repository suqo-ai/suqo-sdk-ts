/**
 * List your payouts, then retrieve one by id. Read-only.
 *
 * Run with a sandbox key — either inline, or via a .env file (see examples/README.md):
 *   SUQO_API_KEY=su_test_key_... npx tsx examples/list-payouts.ts
 */
import "dotenv/config";
import { SuqoClient } from "@suqo/sdk";

const key = process.env.SUQO_API_KEY;
if (!key) throw new Error("Missing SUQO_API_KEY — set it to a sandbox key (su_test_key_...).");
const suqo = new SuqoClient({ apiKey: key });

const page = await suqo.payouts.list();
console.log(`${page.results.length} payout(s) on this page (of ${page.count} total)\n`);

for (const p of page.results) {
  console.log(`${p.payoutId}  ${p.status}  net ${p.netAmount}  requested ${p.requestedDate}`);
}

const first = page.results[0];
if (first) console.log("\nRetrieved:", await suqo.payouts.retrieve(first.payoutId));
