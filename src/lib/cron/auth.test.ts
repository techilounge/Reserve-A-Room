import { describe, expect, it } from "vitest";

import { isCronAuthorized } from "./auth";

describe("isCronAuthorized", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isCronAuthorized("Bearer cron-secret", "cron-secret")).toBe(true);
    expect(isCronAuthorized("Bearer wrong", "cron-secret")).toBe(false);
    expect(isCronAuthorized(null, "cron-secret")).toBe(false);
    expect(isCronAuthorized("Bearer cron-secret", undefined)).toBe(false);
  });
});
