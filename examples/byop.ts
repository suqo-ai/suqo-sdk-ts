/**
 * BYOP (bring your own payment): list payment methods, then optionally set one method's fee.
 *
 * Read-only unless you set BYOP_PAYMENT_METHOD_ID and BYOP_FEE. It never saves credentials —
 * that replaces what is stored and emails your company address (see docs/user/byop.md).
 * The account must be switched to BYOP by Suqo, or writes throw PermissionDeniedError.
 *
 * Run with a sandbox key — either inline, or via a .env file (see examples/README.md):
 *   SUQO_API_KEY=su_test_key_... npx tsx examples/byop.ts
 *   SUQO_API_KEY=su_test_key_... BYOP_PAYMENT_METHOD_ID=<paymentTypeId> BYOP_FEE=1.75 npx tsx examples/byop.ts
 */
import "dotenv/config";
import { PermissionDeniedError, SuqoClient, ValidationError } from "@suqo/sdk";

const suqo = new SuqoClient({ apiKey: requireEnv("SUQO_API_KEY") });

const methods = await suqo.byop.listPaymentMethods();
for (const m of methods) {
  console.log(
    `${m.paymentType.padEnd(18)} ${m.paymentTypeId}  fee=${m.fee ?? "n/a"}  ` +
      `configured=${m.isConfigured}  verified=${m.isVerified ?? "not checked"}`,
  );
}

const id = process.env.BYOP_PAYMENT_METHOD_ID;
const fee = process.env.BYOP_FEE;
if (id && fee) {
  try {
    // "clear" sends null, which removes the fee.
    const saved = await suqo.byop.updateProcessingFee(id, {
      processingFee: fee === "clear" ? null : fee,
    });
    console.log(`\nFee saved: ${saved.processingFee ?? "cleared"}`);
  } catch (err) {
    if (err instanceof PermissionDeniedError) console.error(`\nNot on BYOP: ${err.message}`);
    else if (err instanceof ValidationError)
      console.error("\nRejected:", err.fieldErrors, err.message);
    else throw err;
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
