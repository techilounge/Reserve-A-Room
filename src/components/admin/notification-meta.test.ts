import { describe, expect, it } from "vitest";

import { timeAgo } from "./notification-meta";

describe("timeAgo", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  it("formats short relative times", () => {
    expect(timeAgo("2026-10-01T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-10-01T11:55:00Z", now)).toBe("5 min ago");
    expect(timeAgo("2026-10-01T09:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-09-30T12:00:00Z", now)).toBe("1 day ago");
    expect(timeAgo("2026-09-28T12:00:00Z", now)).toBe("3 days ago");
  });
});
