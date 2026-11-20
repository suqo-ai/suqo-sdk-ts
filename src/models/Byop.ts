/**
 * BYOP ("bring your own payment") model types (`specs/openapi.yaml` `PaymentMethod` /
 * `ByopFee` / `UpdateByopFeeRequest` — SDK-SPEC.md §5). An account on BYOP collects payments on
 * its own gateway accounts; Suqo switches an account to BYOP, the API can't.
 *
 * @packageDocumentation
 */

/** One of the account's payment methods (`openapi.yaml` `PaymentMethod`), hidden ones included. */
export interface PaymentMethod {
  companyId: string;
  /** The id `byop.saveCredentials()` and `byop.updateProcessingFee()` take. A UUID. */
  paymentTypeId: string;
  /**
   * The gateway, e.g. `"esewa"`, `"esewa_intent"`, `"khalti"`, `"nps"`, `"connectips"`,
   * `"fonepay-checkout"`. A plain string: the API may add gateways.
   */
  paymentType: string;
  alias: string | null;
  logo: string | null;
  order: number;
  /** `false` when hidden on the dashboard. */
  isActive: boolean;
  /**
   * Gateway commission in percent, a decimal string. On BYOP, your own `processingFee` (`"0.00"`
   * when unset); `null` for Khalti/NPS (they report their fee per payment) and for cash, and may be
   * `null` when the account isn't on BYOP.
   */
  fee: string | null;
  /** `true` once credentials have been saved. */
  isConfigured: boolean;
  /** The background check on saved credentials: `true` accepted, `false` refused, `null` not run yet. */
  isVerified: boolean | null;
}

/**
 * What `byop.saveCredentials(id, credentials)` accepts: `paymentType` (the method's
 * `PaymentMethod.paymentType`) plus every credential field that gateway needs. All fields are
 * required and none may be empty; checkboxes are confirmations and must be `true`; any other key
 * is refused. The SDK checks this before sending (`SuqoConfigError`) and never sends
 * `paymentType`. Keys are sent snake_case (`merchantSecret` → `merchant_secret`); a rejected field
 * comes back in `ValidationError.fieldErrors` under that wire name. Text/secret values are capped
 * at 500 characters; files (`pfx`, `privateKey`) are base64 strings under 2.5 MB.
 */
export type ByopCredentials =
  | { paymentType: "esewa" | "esewa_intent"; productCode: string; merchantSecret: string }
  | { paymentType: "khalti"; merchantSecret: string }
  | {
      paymentType: "nps";
      merchantId: string;
      merchantName: string;
      apiUsername: string;
      apiPassword: string;
      merchantSecret: string;
      /** Confirms the webhook URL is set on your NPS account. */
      isWebhooksUrlSet: true;
    }
  | {
      paymentType: "connectips";
      merchantId: string;
      appId: string;
      appName: string;
      appPassword: string;
      /** base64 */
      pfx: string;
      pfxPassword: string;
      /** Confirms the response URL is set on your connectIPS account. */
      isResponseUrlConfirmation: true;
    }
  | {
      paymentType: "fonepay-checkout";
      username: string;
      password: string;
      /** base64 */
      privateKey: string;
      terminalId: string;
    };

/** What `byop.updateProcessingFee(id, params)` accepts (`openapi.yaml` `UpdateByopFeeRequest`, renamed). */
export interface UpdateByopFeeParams {
  /** Percent, 0 to 100 with two decimals, as a string (e.g. `"1.75"`). `null` clears it. */
  processingFee: string | null;
}

/** What `byop.updateProcessingFee()` returns (`openapi.yaml` `ByopFee`). */
export interface ByopFee {
  /** As stored, with two decimals — `"1.5"` sent reads back `"1.50"`. */
  processingFee: string | null;
}
