import { createHmac, timingSafeEqual } from "node:crypto";
import type { HttpClient } from "../http/HttpClient.js";
import type {
  CreateWebhookParams,
  ReplaceWebhookParams,
  UpdateWebhookParams,
  Webhook,
  WebhookSecret,
} from "../models/index.js";
import { assertPathId } from "../utils/index.js";

/**
 * `client.webhooks` (SDK-SPEC.md §5, §9). Two jobs on one object:
 *
 * - **`verify()`** makes **no** network call and stores no secret — the host application passes
 *   its own signing secret into every call. It checks an inbound delivery genuinely came from SUQO
 *   and hasn't been tampered with or replayed; it does **not** parse the event body (see
 *   `models/WebhookEvent.ts` for why the event types stay snake_case).
 * - **`list`/`create`/`retrieve`/`replace`/`update`/`delete`/`retrieveSecret`/`testDelivery`**
 *   call the API to manage which endpoint receives which event. They need the client's key, and
 *   work before KYC verification.
 *
 * @packageDocumentation
 */

/** No trailing slash here; `HttpClient`/`buildUrl` guarantees it (Ticket 2). */
const WEBHOOKS_PATH = "/api/v1/webhooks";
/** Sibling routes under `/webhooks/` that an id must never collide with. */
const RESERVED_SEGMENTS = ["secret"] as const;

interface WireWebhook {
  id: string;
  event: string;
  endpoint_url: string;
  is_active: boolean;
  created_at: string;
}

/** Exported for direct unit testing — not part of the SDK's public surface. */
export function deserializeWebhook(wire: WireWebhook): Webhook {
  return {
    id: wire.id,
    event: wire.event,
    endpointUrl: wire.endpoint_url,
    isActive: wire.is_active,
    createdAt: wire.created_at,
  };
}

/** Only keys the caller set are sent, so `update()` leaves everything else untouched. */
function serializeWebhookWrite(params: UpdateWebhookParams): Record<string, unknown> {
  const wire: Record<string, unknown> = {};
  if (params.event !== undefined) wire.event = params.event;
  if (params.endpointUrl !== undefined) wire.endpoint_url = params.endpointUrl;
  if (params.isActive !== undefined) wire.is_active = params.isActive;
  return wire;
}

/** Options accepted by {@link WebhooksResource.verify}. */
export interface VerifyWebhookOptions {
  /**
   * The **raw, unparsed** request body — exactly the bytes SUQO sent, before any JSON-parsing
   * middleware touches it. SDK-SPEC.md §9 rule 1: verifying against a parsed-then-reserialized
   * body is the single most common cause of "signature never matches" — whitespace, key order,
   * and number formatting can all change silently on a round-trip through `JSON.parse`/
   * `JSON.stringify`, even though the *meaning* of the body didn't change at all.
   */
  rawBody: string | Buffer;
  /** The `X-SUQO-Signature` header value, verbatim — e.g. `"sha256=<hex>"`. */
  signature: string;
  /** The `X-SUQO-Timestamp` header value, verbatim — Unix seconds, as a string. */
  timestamp: string;
  /** The webhook signing secret, provided by the host application. Never logged, never stored. */
  secret: string;
  /**
   * Maximum age, in seconds, before a delivery is rejected as stale (defeats replay — SDK-SPEC.md
   * §9 rule 3). Default 300 (~5 minutes).
   */
  toleranceSec?: number;
}

const DEFAULT_TOLERANCE_SEC = 300;
const SIGNATURE_PREFIX = "sha256=";
/**
 * A hex-encoded SHA-256 digest is always exactly 64 hex characters (32 bytes) — the `{64}` is
 * deliberate, not just `+`. `+` alone only checks *which* characters are used, not *how many*;
 * a 3-character string like `"abc"` would pass a `+`-based check despite `Buffer.from("abc",
 * "hex")` still silently truncating to 1 byte, exactly the failure mode this check exists to
 * prevent (found in review: the `+` version let that through, and only "worked" by accident
 * because a separate, later length-equality check happened to catch the resulting mismatch —
 * this regex is now the thing that actually guarantees it, not a lucky side effect of something
 * else).
 */
const HEX_DIGEST_RE = /^[0-9a-f]{64}$/i;

export class WebhooksResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Every webhook registered by your account. Not paginated — the API returns them all. */
  async list(): Promise<Webhook[]> {
    const wire = await this.#http.request<WireWebhook[]>({ method: "GET", path: WEBHOOKS_PATH });
    return wire.map(deserializeWebhook);
  }

  /**
   * Subscribes an `https` endpoint to one event. An account holds at most one webhook per event,
   * and the endpoint must resolve only to public addresses — either failing throws
   * `ValidationError`. Not auto-retryable (SDK-SPEC.md §8, §12).
   */
  async create(params: CreateWebhookParams): Promise<Webhook> {
    const wire = await this.#http.request<WireWebhook, unknown>({
      method: "POST",
      path: WEBHOOKS_PATH,
      body: serializeWebhookWrite(params),
    });
    return deserializeWebhook(wire);
  }

  /** Retrieves one of your own webhooks by id (`whk_…`). */
  async retrieve(id: string): Promise<Webhook> {
    assertPathId(id, "webhooks.retrieve", RESERVED_SEGMENTS);
    const wire = await this.#http.request<WireWebhook>({
      method: "GET",
      path: `${WEBHOOKS_PATH}/${encodeURIComponent(id)}`,
    });
    return deserializeWebhook(wire);
  }

  /**
   * Overwrites a webhook's event, endpoint and active flag (`PUT`). `event` and `endpointUrl` are
   * both required; to change one field on its own, use {@link WebhooksResource.update}. Not
   * auto-retryable (SDK-SPEC.md §8, §12).
   */
  async replace(id: string, params: ReplaceWebhookParams): Promise<Webhook> {
    assertPathId(id, "webhooks.replace", RESERVED_SEGMENTS);
    const wire = await this.#http.request<WireWebhook, unknown>({
      method: "PUT",
      path: `${WEBHOOKS_PATH}/${encodeURIComponent(id)}`,
      body: serializeWebhookWrite(params),
    });
    return deserializeWebhook(wire);
  }

  /**
   * Changes only the fields you send (`PATCH`) — e.g. `{ isActive: false }` pauses deliveries
   * without deleting the webhook. Not auto-retryable (SDK-SPEC.md §8, §12).
   */
  async update(id: string, params: UpdateWebhookParams): Promise<Webhook> {
    assertPathId(id, "webhooks.update", RESERVED_SEGMENTS);
    const wire = await this.#http.request<WireWebhook, unknown>({
      method: "PATCH",
      path: `${WEBHOOKS_PATH}/${encodeURIComponent(id)}`,
      body: serializeWebhookWrite(params),
    });
    return deserializeWebhook(wire);
  }

  /** Removes a webhook. Past delivery records are kept for debugging. Not auto-retryable (SDK-SPEC.md §8, §12). */
  async delete(id: string): Promise<void> {
    assertPathId(id, "webhooks.delete", RESERVED_SEGMENTS);
    await this.#http.request<undefined>({
      method: "DELETE",
      path: `${WEBHOOKS_PATH}/${encodeURIComponent(id)}`,
    });
  }

  /**
   * Returns the account's signing secret — the `secret` to pass to {@link WebhooksResource.verify}.
   * The API creates it on the first call; it can't be rotated through the API. Treat it like a
   * password: never log it.
   */
  async retrieveSecret(): Promise<WebhookSecret> {
    const wire = await this.#http.request<{ signing_secret: string }>({
      method: "GET",
      path: `${WEBHOOKS_PATH}/secret`,
    });
    return { signingSecret: wire.signing_secret };
  }

  /**
   * Queues a signed test delivery to the webhook's endpoint so you can check your receiver. It
   * resolves once the job is queued; the delivery itself arrives asynchronously. Note a test
   * delivery's body differs from a real event's (fields under `data`) — use it to check
   * `verify()`, not your payload parsing. Not auto-retryable (SDK-SPEC.md §8, §12).
   */
  async testDelivery(id: string): Promise<void> {
    assertPathId(id, "webhooks.testDelivery", RESERVED_SEGMENTS);
    await this.#http.request<unknown>({
      method: "POST",
      path: `${WEBHOOKS_PATH}/${encodeURIComponent(id)}/test-delivery`,
    });
  }

  /**
   * Verifies an inbound webhook delivery's signature. Returns `false` for any failure mode —
   * malformed signature, expired timestamp, or a genuine mismatch — never throws, so a caller
   * never needs a `try`/`catch` just to check a delivery.
   *
   * @example
   * ```ts
   * // Express: mount express.raw() on this route so req.body is a Buffer, not parsed JSON.
   * const ok = suqo.webhooks.verify({
   *   rawBody: req.body,
   *   signature: req.header("X-SUQO-Signature")!,
   *   timestamp: req.header("X-SUQO-Timestamp")!,
   *   secret: process.env.SUQO_WEBHOOK_SECRET!,
   * });
   * ```
   */
  verify(options: VerifyWebhookOptions): boolean {
    const { rawBody, signature, timestamp, secret, toleranceSec = DEFAULT_TOLERANCE_SEC } = options;

    // The types say these are always strings (or a Buffer for rawBody), but that's only a
    // compile-time promise — a caller reading a header via `req.header(...)!` (the exact pattern
    // this class's own TSDoc example recommends) gets `string | undefined` at runtime, and the
    // `!` doesn't make the value real if the header is genuinely missing. Without this guard,
    // a missing header crashed here instead of returning the documented `false` (found in
    // review, reproduced: undefined signature/timestamp/rawBody each threw a raw TypeError).
    if (typeof signature !== "string" || typeof timestamp !== "string" || typeof secret !== "string") {
      return false;
    }
    if (typeof rawBody !== "string" && !Buffer.isBuffer(rawBody)) {
      return false;
    }

    if (!signature.startsWith(SIGNATURE_PREFIX)) return false;
    const providedHex = signature.slice(SIGNATURE_PREFIX.length);
    // Buffer.from(str, "hex") silently truncates at the first invalid hex character instead of
    // throwing — checking the format explicitly first means a malformed signature is rejected
    // for being malformed, not accidentally passed through as a shorter, wrong-length buffer.
    if (!HEX_DIGEST_RE.test(providedHex)) return false;

    // `Number("")` is 0, not NaN — an empty timestamp must not be treated as epoch 0, which would
    // always fail the freshness check anyway here, but the intent is "reject explicitly," not
    // "happen to fail for an unrelated reason."
    if (timestamp.trim().length === 0) return false;
    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds)) return false;

    const nowSeconds = Date.now() / 1000;
    if (Math.abs(nowSeconds - timestampSeconds) > toleranceSec) return false;

    const expectedHex = createHmac("sha256", secret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest("hex");

    const provided = Buffer.from(providedHex, "hex");
    const expected = Buffer.from(expectedHex, "hex");
    // timingSafeEqual throws on mismatched lengths rather than returning false — checked
    // explicitly first, both to avoid the throw and because the length check itself doesn't leak
    // anything meaningful (the correct length is public: always 32 bytes for SHA-256).
    if (provided.length !== expected.length) return false;

    return timingSafeEqual(provided, expected);
  }
}
