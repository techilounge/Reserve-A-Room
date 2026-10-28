import { describe, expect, it, vi } from "vitest";

import { withEmailProviderTimeout } from "./provider-timeout";

describe("withEmailProviderTimeout", () => {
  it("returns a timely provider response", async () => {
    await expect(withEmailProviderTimeout(async () => "sent", 50)).resolves.toBe("sent");
  });

  it("stops waiting after the configured budget", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const pending = withEmailProviderTimeout((providedSignal) => {
      signal = providedSignal;
      return new Promise<string>(() => {});
    }, 100);
    const expectation = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
    expect(signal?.aborted).toBe(true);
    vi.useRealTimers();
  });
});
