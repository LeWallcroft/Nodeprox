import { describe, expect, it } from "vitest";
import type { DomainEventDispatcher } from "../../apps/api/src/modules/events/application/domain-event-dispatcher.js";
import { DomainEventDispatcherRuntime } from "../../apps/api/src/modules/events/infrastructure/domain-event-dispatcher.runtime.js";

const logger = {
  debug: () => undefined,
  error: () => undefined,
};

describe("DomainEventDispatcherRuntime", () => {
  it("survives a failed batch and continues polling", async () => {
    let calls = 0;
    const dispatcher = {
      runOnce: async () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary");
        return { claimed: 0, processed: 0, failed: 0, skipped: 0 };
      },
    } as unknown as DomainEventDispatcher;
    const runtime = new DomainEventDispatcherRuntime(dispatcher, logger, 1);

    runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 15));
    await runtime.stop(100);

    expect(calls).toBeGreaterThan(1);
  });

  it("stops polling before shutdown completes", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dispatcher = {
      runOnce: async () => {
        calls += 1;
        await pending;
        return { claimed: 1, processed: 1, failed: 0, skipped: 0 };
      },
    } as unknown as DomainEventDispatcher;
    const runtime = new DomainEventDispatcherRuntime(dispatcher, logger, 1);

    runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 1));
    const stopping = runtime.stop(100);
    release?.();
    await stopping;
    const callsAfterStop = calls;
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(callsAfterStop).toBe(1);
    expect(calls).toBe(callsAfterStop);
  });
});
