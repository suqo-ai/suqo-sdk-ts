# SUQO SDK — TypeScript (server-side) Addendum

Concrete build decisions for the **lead** implementation. This layers on
[`SDK-SPEC.md`](../specs/SDK-SPEC.md) (behaviour contract) and
[`openapi.yaml`](../specs/openapi.yaml) (wire contract). Where the general spec says
"the SDK MUST…", this file says *how*, in TypeScript.

Package name: `@suqo/sdk`. **Server-side only** — Node, not browsers.

---

## 1. Runtime & language targets

| Concern            | Decision                                                                 |
| ------------------ | ------------------------------------------------------------------------ |
| Node version floor | **Node 18+** (built-in global `fetch`, `crypto.timingSafeEqual`, Web Crypto). Drop-in for 20/22. |
| Module format      | Dual **ESM + CJS** via a build step; `"type": "module"` source, both outputs in `exports`. |
| Language           | **TypeScript 5.x**, `strict: true`. Ship `.d.ts`.                        |
| Target             | `ES2022`.                                                                |

Node 18 is the floor specifically so the HTTP client and HMAC can use built-ins
with zero runtime dependencies.

---

## 2. HTTP client

- **Built-in `fetch`** (undici under the hood in Node 18+). **No axios, no
  node-fetch** — zero HTTP dependencies.
- Keep-alive is on by default in undici; expose an optional custom
  `dispatcher`/agent for callers who tune pooling.
- **Timeout** via `AbortController` + `AbortSignal.timeout(ms)`; default 30_000 ms,
  overridable per-client and per-call.

---

## 3. Dependencies

- **Runtime: none.** HTTP = `fetch`; HMAC = `node:crypto`.
- **Dev only:** `typescript`, `tsup` (dual-format build), `vitest` (tests),
  `msw` or `nock` (mock server for contract tests), `@biomejs/biome` or
  `eslint` + `prettier` (lint/format), `openapi-typescript` (generate model types
  from `openapi.yaml`).

Keeping runtime deps at zero is a deliberate supply-chain and version-stability
choice.

---

## 4. Model generation

- Run `openapi-typescript openapi.yaml -o src/generated/schema.ts` to derive
  request/response **types** from the contract. Generated file is checked in and
  regenerated in CI; a diff means the hand-written surface is out of sync with the
  spec → fail CI.
- Hand-write the **ergonomic layer** (resource classes, client, errors, retry,
  pagination iterator, webhook verify). Only the *types* are generated; behaviour
  is authored.

---

## 5. Client construction & environment inference

```ts
import { SuqoClient } from "@suqo/sdk";

// Environment inferred purely from the key prefix — nothing else needed.
const suqo = new SuqoClient({ apiKey: process.env.SUQO_API_KEY! });

// su_test_key_… -> https://test.be.suqo.ai   (sandbox)
// su_key_…      -> https://be.suqo.ai         (live)
```

Constructor options:

```ts
interface SuqoClientOptions {
  apiKey: string;
  /** Optional explicit override. If set AND it disagrees with the key prefix,
   *  the constructor throws SuqoConfigError. Normally omit this. */
  baseUrl?: string;
  /** Per-client default; per-call override also allowed. Default 30_000. */
  timeout?: number;
  /** Read-retry tuning. Writes are never retried (see spec §8, §12). */
  maxRetries?: number;      // default 2 (reads only)
  /** Advanced: custom undici dispatcher for pool tuning. */
  dispatcher?: unknown;
}
```

Inference logic (authoritative order — test prefix first):

```ts
function resolveBaseUrl(apiKey: string, override?: string): string {
  const LIVE = "https://be.suqo.ai";
  const SANDBOX = "https://test.be.suqo.ai";

  let inferred: string;
  if (apiKey.startsWith("su_test_key_")) inferred = SANDBOX;
  else if (apiKey.startsWith("su_key_")) inferred = LIVE;
  else
    throw new SuqoConfigError(
      `Malformed SUQO API key: expected prefix "su_key_" (live) or ` +
        `"su_test_key_" (sandbox).`,
    );

  if (override && override !== inferred)
    throw new SuqoConfigError(
      `Environment mismatch: key implies ${inferred} but baseUrl was ` +
        `set to ${override}. Remove baseUrl or use a matching key.`,
    );

  return override ?? inferred;
}
```

`SuqoConfigError` is thrown **before any request** — the malformed-key and
mismatch cases are integration mistakes, surfaced like a syntax/config error, not
an HTTP failure.

The key is stored non-enumerably and redacted in `toJSON`/`util.inspect` so it
never lands in a log line.

---

## 6. Resource surface

```ts
suqo.products.list({ page?, pageSize? })                 // -> ProductPage
suqo.subscriptions.list({ page?, pageSize? })            // -> SubscriptionPage (+status counts)
suqo.subscriptions.create({ pbpId, returnUrl, client })  // -> CreateSubscriptionResponse
suqo.subscriptions.cancel(id)                            // -> { message: string }
suqo.subscriptions.updateBillingCycle({ subscriptionId, nextBillingCycle })
suqo.customers.list()      // stub -> throws until documented (spec §11)
suqo.customers.retrieve(id) // stub

suqo.webhooks.verify({ rawBody, signature, timestamp, secret, toleranceSec? })
```

- Method args are **camelCase**; the client maps to the API's snake_case
  (`pbpId` → `pbp_id`, `nextBillingCycle` → `next_billing_cycle`) at the
  serialization boundary. Callers never see snake_case.
- Every path is built with the **trailing slash** baked in; query strings append
  after it.
- **Decimal fields stay `string`** in all types (`price`, `amount`,
  `total_subscribers`). Never `number`. Documented at each field.

---

## 7. Pagination

```ts
const page = await suqo.subscriptions.list({ pageSize: 50 });
page.results;              // Subscription[]
page.count;                // number
page.activeSubscriptions;  // extended count (subscriptions list only)

// Auto-iterate every page, following `next` until null:
for await (const sub of suqo.subscriptions.listAll({ pageSize: 100 })) {
  // sub: Subscription
}
```

`listAll` returns an `AsyncIterableIterator`; it stops when `next` is `null`.

---

## 8. Errors

```ts
import {
  SuqoError, SuqoConfigError, AuthenticationError, KycRequiredError,
  ValidationError, NotFoundError, RateLimitError, ServerError, NetworkError,
} from "@suqo/sdk";

try {
  await suqo.subscriptions.create({ /* … */ });
} catch (e) {
  if (e instanceof ValidationError) {
    e.fieldErrors;   // Record<string, string[]>  (empty if the 400 used `detail`)
    e.message;       // populated when the 400 was `{ detail: … }`
  } else if (e instanceof KycRequiredError) {
    e.kycStatus;     // the KYC status string
  }
}
```

All extend `SuqoError` (`status`, `rawBody`, `message`). The mapper accepts both
the field-keyed and `detail` 400 shapes and always yields a typed class, so
`instanceof` checks are reliable regardless of wire shape.

---

## 9. Webhook verification

```ts
import { SuqoClient } from "@suqo/sdk";

// Express: mount express.raw() on the webhook route so req.body is a Buffer.
app.post("/hooks/suqo", express.raw({ type: "application/json" }), (req, res) => {
  const ok = suqo.webhooks.verify({
    rawBody: req.body,                        // Buffer — raw bytes, NOT parsed
    signature: req.header("X-SUQO-Signature")!,
    timestamp: req.header("X-SUQO-Timestamp")!,
    secret: process.env.SUQO_WEBHOOK_SECRET!, // whsec_…
    toleranceSec: 300,                        // reject older than ~5 min
  });
  if (!ok) return res.sendStatus(400);
  res.sendStatus(200);                        // ack fast; process async
  // enqueue for async handling here
});
```

Implementation uses `crypto.createHmac("sha256", secret)`, feeds
`` `${timestamp}.` `` then the raw body buffer, compares with
`crypto.timingSafeEqual` after a length check. TSDoc calls out the JSON
body-parser trap explicitly.

`verify` makes **no** network call. `amount` in event payloads is typed `string`.

---

## 10. Package layout

```
@suqo/sdk
├── src/
│   ├── client.ts            # SuqoClient, construction, env inference
│   ├── http.ts              # fetch wrapper: auth header, trailing slash, timeout, retry
│   ├── errors.ts            # SuqoError hierarchy + response→error mapper
│   ├── pagination.ts        # page envelope + listAll async iterator
│   ├── resources/
│   │   ├── products.ts
│   │   ├── subscriptions.ts
│   │   └── customers.ts     # stub methods (spec §11)
│   ├── webhooks.ts          # verify()
│   ├── generated/schema.ts  # openapi-typescript output (checked in)
│   └── index.ts             # public exports
├── docs/
│   ├── rate-limiting.md      # Planned stub (spec §10)
│   └── idempotency.md        # Planned stub (spec §12)
├── test/                     # vitest: unit + contract-against-mock
├── openapi.yaml              # copy/symlink of the source contract
├── package.json              # exports: ESM+CJS, types; engines.node >=18
├── tsconfig.json             # strict, ES2022
├── CHANGELOG.md              # starts 1.0.0
└── README.md                 # server-side-only warning up top
```

---

## 11. Testing (TypeScript specifics)

- **vitest** for unit + contract suites.
- **Contract tests:** stand up a mock from `openapi.yaml` (msw/nock) and assert
  the SDK's outgoing requests (path incl. trailing slash, Bearer header,
  snake_case body) and its decoding of spec-shaped responses.
- **Must-cover units:**
  - prefix→env: `su_test_key_`→sandbox, `su_key_`→live, malformed→`SuqoConfigError`,
    override-conflict→`SuqoConfigError`.
  - trailing slash present on every built URL, including with query params.
  - error mapper: field-keyed 400 → `ValidationError.fieldErrors`; `detail` 400 →
    `ValidationError.message`; 401/403-kyc/404/5xx → correct classes.
  - decimal strings never become `number`.
  - `listAll` follows `next` and stops at `null`.
  - webhook verify: valid, tampered body, stale timestamp, and the
    parsed-then-reserialized-body failure.
  - writes are not auto-retried; reads are.
  - key never appears in `inspect`/`toJSON` output.

---

## 12. Publishing & versioning

- Published to **npm** as `@suqo/sdk`, public.
- **SemVer**, major tracks API `v1` (see spec §13). First release `1.0.0`.
- Tagged release → CI runs the matrix (Node 18/20/22), builds dual-format,
  regenerates types from `openapi.yaml` (diff must be clean), publishes with
  provenance.
- `CHANGELOG.md` entry required per release.
