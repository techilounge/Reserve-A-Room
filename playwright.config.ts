import { defineConfig, devices } from "@playwright/test";

import { TEST_ANON_KEY, TEST_SERVICE_KEY } from "./e2e/support/accounts";

/**
 * End-to-end suite. Runs a production build of the app against the test-only mock
 * Supabase (e2e/support/mock-supabase.ts: the real migrations on PGlite), so it needs no
 * Docker, no network and no real credentials.
 *
 *   npm run test:e2e
 *
 * The first run builds into .next-e2e (a few minutes). Set PLAYWRIGHT_CHROMIUM_EXECUTABLE
 * to use an already-installed Chromium instead of `npx playwright install chromium`.
 */

const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3300);
const MOCK_PORT = Number(process.env.MOCK_SUPABASE_PORT ?? 54400);
const baseURL = `http://localhost:${APP_PORT}`;
const supabaseUrl = `http://localhost:${MOCK_PORT}`;

export default defineConfig({
  testDir: "e2e",
  // Tests share one database, and a few assert on global state (availability, races),
  // so they run one at a time. Each test uses its own dates, emails and client IP.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    timezoneId: "America/Chicago",
    locale: "en-US",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/support/mock-supabase.ts",
      url: `${supabaseUrl}/health`,
      env: { MOCK_SUPABASE_PORT: String(MOCK_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx next build && npx next start -p ${APP_PORT}`,
      url: baseURL,
      env: {
        NEXT_DIST_DIR: ".next-e2e",
        NEXT_PUBLIC_APP_URL: baseURL,
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: TEST_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: TEST_SERVICE_KEY,
        GUEST_LINK_SECRET: "e2e-guest-link-secret",
        RATE_LIMIT_SECRET: "e2e-rate-limit-secret",
        CRON_SECRET: "e2e-cron-secret",
        // Never send real email or use real bot checks from tests.
        RESEND_API_KEY: "",
        RESEND_FROM_EMAIL: "",
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
        TURNSTILE_SECRET_KEY: "",
      },
      reuseExistingServer: false,
      timeout: 600_000,
    },
  ],
});
