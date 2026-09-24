import { describe, expect, it } from "vitest";

import { getAppUrl } from "./app-url";

describe("getAppUrl", () => {
  it("uses the branch URL on Vercel previews so preview emails never link to production", () => {
    const url = getAppUrl({
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: "reserve-a-room-git-feature.vercel.app",
      NEXT_PUBLIC_APP_URL: "https://reservearoom.stonehillchurch.org",
    });
    expect(url.origin).toBe("https://reserve-a-room-git-feature.vercel.app");
  });

  it("uses NEXT_PUBLIC_APP_URL in production", () => {
    const url = getAppUrl({
      VERCEL_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://reservearoom.stonehillchurch.org",
      VERCEL_PROJECT_PRODUCTION_URL: "reserve-a-room.vercel.app",
    });
    expect(url.origin).toBe("https://reservearoom.stonehillchurch.org");
  });

  it("falls back to the Vercel production URL, then localhost", () => {
    expect(getAppUrl({ VERCEL_PROJECT_PRODUCTION_URL: "reserve-a-room.vercel.app" }).origin).toBe(
      "https://reserve-a-room.vercel.app",
    );
    expect(getAppUrl({}).origin).toBe("http://localhost:3000");
  });
});
