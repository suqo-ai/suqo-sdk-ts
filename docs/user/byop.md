# BYOP (bring your own payment)

`suqo.byop` lets an account collect payments on its **own** gateway accounts (eSewa, Khalti, NPS, connectIPS, Fonepay) instead of Suqo's. Suqo switches an account to BYOP — the API can't. Until then `replaceCredentials()` and `updateProcessingFee()` throw `PermissionDeniedError` ("Your own payment account isn't enabled."); `listPaymentMethods()` still works.

## List payment methods

```ts
const methods = await suqo.byop.listPaymentMethods(); // every method, hidden ones included; not paginated
const esewa = methods.find((m) => m.paymentType === 'esewa')!;
```

Each `PaymentMethod` carries `paymentTypeId` (the id the two calls below take), `isActive`, `fee` (a decimal string, or `null` for Khalti/NPS/cash), `isConfigured` and `isVerified`. Showing, hiding and reordering stay on the dashboard.

## Replace credentials

```ts
await suqo.byop.replaceCredentials(esewa.paymentTypeId, {
  paymentType: 'esewa', // the method's paymentType — lets TypeScript check the fields; not sent
  productCode: 'EPAYTEST',
  merchantSecret: process.env.ESEWA_SECRET!,
});
```

- **Send the full set every time** — it replaces what is stored. Write keys in camelCase (`merchantSecret`); the SDK sends them snake_case (`merchant_secret`), and a snake_case key throws `SuqoConfigError`.
- **Every field below is required for its gateway, and none can be empty.** TypeScript flags a missing or misspelled field at compile time; at runtime the API checks the set and a refused one is a `ValidationError`. A gateway not listed here is sent as is.
- Fields per gateway:

  | Gateway (`paymentType`)       | Fields                                                                                              |
  | ----------------------------- | --------------------------------------------------------------------------------------------------- |
  | `esewa`, `esewa_intent`       | `productCode`, `merchantSecret`                                                                     |
  | `khalti`                      | `merchantSecret`                                                                                    |
  | `nps`                         | `merchantId`, `merchantName`, `apiUsername`, `apiPassword`, `merchantSecret`, `isWebhooksUrlSet: true` |
  | `connectips`                  | `merchantId`, `appId`, `appName`, `appPassword`, `pfx` (base64), `pfxPassword`, `isResponseUrlConfirmation: true` |
  | `fonepay-checkout`            | `username`, `password`, `privateKey` (base64), `terminalId`                                        |

  Text and secret values are capped at 500 characters; files are base64 strings under 2.5 MB; checkbox fields confirm you've set that up on your gateway account and must be `true`.
- Credentials are **never returned**. The API checks them in the background — call `listPaymentMethods()` later and read `isVerified` (`true` accepted, `false` refused, `null` not checked yet).
- Replacing saved credentials emails your company address.
- A `ValidationError` keyed on a field never echoes the value you sent. Its `fieldErrors` keys are the snake_case wire names: send `merchantSecret`, read `err.fieldErrors.merchant_secret`. One with only a message (raw body `code: "byop_payment_pending"`) means a payment on this gateway is still processing — try again once it finishes.

## Set the processing fee

```ts
await suqo.byop.updateProcessingFee(esewa.paymentTypeId, { processingFee: '1.75' }); // percent, 0–100, two decimals
await suqo.byop.updateProcessingFee(esewa.paymentTypeId, { processingFee: null });   // clear it (counts as 0)
```

The fee is a string, never a number, so there's no float rounding. It comes back as stored, with two decimals (`'1.5'` → `'1.50'`); over 100 is a `ValidationError` on `processing_fee`. Khalti and NPS report their own fee on each payment, so setting one for them is a `ValidationError`.

## Retries and rate limits

`replaceCredentials` and `updateProcessingFee` are writes, so the SDK never retries them. Both are rate-limited: past the limit they throw `RateLimitError` — wait `err.retryAfter` milliseconds and retry yourself. See [rate-limiting.md](rate-limiting.md).
