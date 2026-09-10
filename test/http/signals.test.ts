import { getEventListeners } from "node:events";
import { describe, expect, it } from "vitest";
import { combineSignals } from "../../src/http/signals.js";

describe("combineSignals", () => {
  it("aborts the combined signal when any input signal aborts", () => {
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    const { signal } = combineSignals([controllerA.signal, controllerB.signal]);

    expect(signal.aborted).toBe(false);
    controllerB.abort("reason-b");
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe("reason-b");
  });

  it("resolves immediately-aborted (already aborted before combining) as already aborted", () => {
    const controller = new AbortController();
    controller.abort("already gone");
    const { signal } = combineSignals([controller.signal]);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe("already gone");
  });

  it("skips undefined entries without throwing", () => {
    const controller = new AbortController();
    const { signal } = combineSignals([undefined, controller.signal, undefined]);
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it("cleanup() actually removes its listeners — no leak on a long-lived shared signal (found in review)", () => {
    const shared = new AbortController();
    expect(getEventListeners(shared.signal, "abort")).toHaveLength(0);

    // Simulate several attempts/calls sharing one long-lived signal, each combining then
    // cleaning up — the real usage pattern in HttpClient's retry loop / repeated requests.
    for (let i = 0; i < 20; i++) {
      const { cleanup } = combineSignals([new AbortController().signal, shared.signal]);
      cleanup();
    }

    // The precise proof: exactly zero listeners remain on the shared signal after 20 rounds of
    // attach/detach, not "some number less than 20" — a real leak would show growth here.
    expect(getEventListeners(shared.signal, "abort")).toHaveLength(0);
  });

  it("without cleanup(), the listener would remain — proving cleanup() is what does the work, not a no-op", () => {
    const shared = new AbortController();
    combineSignals([shared.signal]); // deliberately not calling cleanup()
    expect(getEventListeners(shared.signal, "abort")).toHaveLength(1);
  });
});
