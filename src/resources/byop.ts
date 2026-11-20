import type { HttpClient } from "../http/HttpClient.js";
import type {
  ByopCredentials,
  ByopFee,
  PaymentMethod,
  UpdateByopFeeParams,
} from "../models/index.js";
import { SuqoConfigError } from "../errors/index.js";
import { assertPathId } from "../utils/index.js";

/**
 * `client.byop` (SDK-SPEC.md §5) — "bring your own payment": collect payments on your own gateway
 * accounts. Every write answers `PermissionDeniedError` ("Your own payment account isn't
 * enabled.") until Suqo switches the account to BYOP.
 *
 * @packageDocumentation
 */

/** No trailing slash here; `HttpClient`/`buildUrl` guarantees it. */
const BYOP_PATH = "/api/v1/byop";

interface WirePaymentMethod {
  company_id: string;
  payment_type_id: string;
  payment_type: string;
  alias?: string | null;
  logo?: string | null;
  order: number;
  is_active: boolean;
  fee?: string | null;
  is_configured: boolean;
  is_verified?: boolean | null;
}

/** Exported for direct unit testing — not part of the SDK's public surface. */
export function deserializePaymentMethod(wire: WirePaymentMethod): PaymentMethod {
  return {
    companyId: wire.company_id,
    paymentTypeId: wire.payment_type_id,
    paymentType: wire.payment_type,
    alias: wire.alias ?? null,
    logo: wire.logo ?? null,
    order: wire.order,
    isActive: wire.is_active,
    fee: wire.fee ?? null,
    isConfigured: wire.is_configured,
    isVerified: wire.is_verified ?? null,
  };
}

/** `merchantSecret` → `merchant_secret`. Only keys from `CREDENTIAL_FIELDS` reach it. */
function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Every field each gateway needs (backend-confirmed 2026-11-20: all required, none empty, extras
 * refused). Checkboxes must be `true`. A gateway the API adds later needs an entry here.
 */
const CREDENTIAL_FIELDS: Record<string, { text: readonly string[]; checkbox?: string }> = {
  esewa: { text: ["productCode", "merchantSecret"] },
  esewa_intent: { text: ["productCode", "merchantSecret"] },
  khalti: { text: ["merchantSecret"] },
  nps: {
    text: ["merchantId", "merchantName", "apiUsername", "apiPassword", "merchantSecret"],
    checkbox: "isWebhooksUrlSet",
  },
  connectips: {
    text: ["merchantId", "appId", "appName", "appPassword", "pfx", "pfxPassword"],
    checkbox: "isResponseUrlConfirmation",
  },
  "fonepay-checkout": { text: ["username", "password", "privateKey", "terminalId"] },
};

/** Checks `credentials` against its gateway's field list and returns the snake_case wire body. */
function serializeCredentials(credentials: ByopCredentials): Record<string, string | boolean> {
  const fail: (why: string) => never = (why) => {
    throw new SuqoConfigError(`byop.saveCredentials(): ${why}`);
  };
  const { paymentType, ...fields } = (credentials ?? {}) as { paymentType?: unknown } & Record<
    string,
    unknown
  >;
  // hasOwn: "toString"/"constructor" would otherwise match inherited Object.prototype members.
  const spec =
    typeof paymentType === "string" && Object.hasOwn(CREDENTIAL_FIELDS, paymentType)
      ? CREDENTIAL_FIELDS[paymentType]
      : undefined;
  if (!spec) {
    fail(
      `unknown paymentType ${JSON.stringify(paymentType)} — expected one of ${Object.keys(CREDENTIAL_FIELDS).join(", ")}`,
    );
  }
  const allowed = spec.checkbox ? [...spec.text, spec.checkbox] : spec.text;
  const body: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.includes(key))
      fail(`"${key}" isn't a ${paymentType} field — expected ${allowed.join(", ")}`);
    body[toSnakeCase(key)] = value as string | boolean;
  }
  for (const key of spec.text) {
    const value = fields[key];
    // The value itself is never put in the message — these are secrets.
    if (typeof value !== "string" || value.trim() === "")
      fail(`${key} is required and can't be empty`);
  }
  if (spec.checkbox && fields[spec.checkbox] !== true) {
    fail(`${spec.checkbox} must be true — confirm it's set up on your gateway account`);
  }
  return body;
}

export class ByopResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Every payment method on your account, hidden ones included. Not paginated. Use a method's
   * `paymentTypeId` with {@link ByopResource.saveCredentials} and {@link ByopResource.updateProcessingFee}.
   */
  async listPaymentMethods(): Promise<PaymentMethod[]> {
    const wire = await this.#http.request<WirePaymentMethod[]>({
      method: "GET",
      path: `${BYOP_PATH}/payment-methods`,
    });
    return wire.map(deserializePaymentMethod);
  }

  /**
   * Saves your own gateway credentials for one payment method. Send the full set every time — it
   * replaces what is stored. Credentials are never returned; the API checks them in the
   * background, so read `isVerified` from {@link ByopResource.listPaymentMethods} afterwards.
   * Replacing saved credentials emails your company address. A `ValidationError` keyed on a field
   * never echoes the submitted value; one with `detail` alone (raw body `code:
   * "byop_payment_pending"`) means a payment on this gateway is still processing — retry once it
   * finishes. Rate-limited (`RateLimitError`). Not auto-retryable (SDK-SPEC.md §8, §12).
   */
  async saveCredentials(paymentMethodId: string, credentials: ByopCredentials): Promise<void> {
    assertPathId(paymentMethodId, "byop.saveCredentials");
    const body = serializeCredentials(credentials);
    await this.#http.request<unknown, unknown>({
      method: "PATCH",
      path: `${BYOP_PATH}/credentials/${encodeURIComponent(paymentMethodId)}`,
      body,
    });
  }

  /**
   * Sets the percent your own gateway takes from each payment on this method, used as the gateway
   * fee when a BYOP payment settles (`0` when unset). `null` clears it. Refused with
   * `ValidationError` for Khalti and NPS, which report their own fee per payment. Rate-limited
   * (`RateLimitError`). Not auto-retryable (SDK-SPEC.md §8, §12).
   */
  async updateProcessingFee(
    paymentMethodId: string,
    params: UpdateByopFeeParams,
  ): Promise<ByopFee> {
    assertPathId(paymentMethodId, "byop.updateProcessingFee");
    // An omitted key would send `{}` and read back as "cleared" — make clearing explicit (`null`).
    // Catches a missing key and a number (which would send a float — SDK-SPEC §5) in one check.
    const fee: unknown = params?.processingFee;
    if (fee !== null && typeof fee !== "string") {
      throw new SuqoConfigError(
        "byop.updateProcessingFee() requires processingFee (a decimal string, or null to clear)",
      );
    }
    const wire = await this.#http.request<{ processing_fee?: string | null }, unknown>({
      method: "PATCH",
      path: `${BYOP_PATH}/fees/${encodeURIComponent(paymentMethodId)}`,
      body: { processing_fee: params.processingFee },
    });
    return { processingFee: wire.processing_fee ?? null };
  }
}
