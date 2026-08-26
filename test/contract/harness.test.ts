import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SuqoClient } from "../../src/client.js";
import { getLastRequest, resetCapturedRequests, server } from "./support.js";

/**
 * Proves the contract-test harness itself works before the full suite (Ticket 7's remaining
 * commits) is built on top of it — a real `SuqoClient`, a real `fetch` call, intercepted by a real
 * HTTP mock server (not a stubbed `fetch`), decoded through the SDK's actual response pipeline.
 */
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  resetCapturedRequests();
});
afterAll(() => server.close());

describe("contract-test harness", () => {
  it("a real SuqoClient call is actually intercepted by the mock server, end to end", async () => {
    const suqo = new SuqoClient({ apiKey: "su_test_key_abc123" });
    const page = await suqo.products.list();

    expect(page.results).toHaveLength(1);
    expect(page.results[0]?.productId).toBe("de337e17-59a1-4dea-b8b2-1877b9813ebc");

    const captured = getLastRequest();
    expect(captured?.method).toBe("GET");
    expect(captured?.url).toBe("https://test.be.suqo.ai/api/v1/products/");
  });

  it("a parameterized path (:id) handler matches a real id, proving path-param routes work too", async () => {
    const suqo = new SuqoClient({ apiKey: "su_test_key_abc123" });
    const customer = await suqo.customers.retrieve(999999);

    expect(customer.id).toBe(42); // the handler's fixed mock response, id in the URL doesn't affect it
    expect(getLastRequest()?.url).toBe("https://test.be.suqo.ai/api/v1/customers/999999/");
  });

  it("onUnhandledRequest: 'error' means an endpoint with no matching handler throws, not silently passes through", async () => {
    // Configured once in beforeAll above, inherited by every other file that imports `server`
    // from support.ts -- this is what makes the harness a genuine contract check rather than a
    // mock that quietly no-ops on anything it wasn't told about. Asserted directly against
    // fetch (there's no unhandled route reachable through the public SDK surface itself), proving
    // the harness's own safety net actually fires rather than assuming it does.
    await expect(fetch("https://test.be.suqo.ai/api/v1/unhandled-route/")).rejects.toThrow();
  });
});
