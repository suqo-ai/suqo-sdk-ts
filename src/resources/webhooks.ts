import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * `client.webhooks` (SDK-SPEC.md §5, §9). Makes **no** network calls and stores no secret — the
 * host application passes its own signing secret into every call. Verifies an inbound delivery
 * genuinely came from SUQO and hasn't been tampered with or replayed; it does **not** parse the
 * event body itself (see `models/WebhookEvent.ts` for why the event types stay snake_case).
 *
 * @packageDocumentation
 */

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
/** A hex-encoded SHA-256 digest is always exactly 64 lowercase hex characters (32 bytes). */
const HEX_DIGEST_RE = /^[0-9a-f]+$/i;

export class WebhooksResource {
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
