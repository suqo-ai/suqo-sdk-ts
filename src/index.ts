/**
 * SDK entry point. Replace this stub with your own client, resources, and types.
 *
 * @packageDocumentation
 */

/** SDK version, stamped into request headers (keep in sync with package.json). */
export const VERSION = "0.0.1";

/** Base class for every error thrown by the SDK. */
export class ApiError extends Error {
  /** HTTP status code, if the error came from a response. */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    if (status !== undefined) this.status = status;
    // Restore prototype chain so `instanceof` works after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Configuration for {@link Client}. */
export interface ClientOptions {
  /** Your API key. */
  apiKey: string;
  /** Override the base URL (env/proxy/tests). */
  baseUrl?: string;
  /** Custom fetch implementation. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/**
 * Minimal API client skeleton.
 *
 * Wire real resources onto this class (e.g. `this.widgets = new Widgets(...)`)
 * and route calls through a shared HTTP helper.
 */
export class Client {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;

  constructor(options: ClientOptions) {
    if (!options.apiKey) throw new ApiError("`apiKey` is required.");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.example.com").replace(/\/+$/, "");
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  /** Placeholder request — replace with typed resource methods. */
  async request<T>(path: string): Promise<T> {
    const res = await this.fetch(`${this.baseUrl}/${path.replace(/^\/+/, "")}`, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
    });
    if (!res.ok) throw new ApiError(`Request failed: ${res.status}`, res.status);
    return res.json() as Promise<T>;
  }
}
