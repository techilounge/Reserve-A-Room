import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { ROOMS } from "./support/accounts";
import { daysFromToday, signInAs } from "./support/helpers";

/** WCAG 2.2 AA (axe) and no horizontal scrolling from 320 to 1920 px, light and dark. */

const PUBLIC_PAGES = [
  "/",
  "/rooms",
  `/rooms/${ROOMS.conference.slug}`,
  `/rooms/${ROOMS.hall.slug}`,
  "/availability",
  "/reserve",
  "/privacy",
  "/terms",
  `/reserve?room=${ROOMS.hall.slug}&date=${daysFromToday(20)}&start=10:00&end=11:00`,
  "/offline",
  "/admin/login",
  "/admin/forgot-password",
  "/this-page-does-not-exist",
];

const ADMIN_PAGES = [
  "/admin",
  "/admin/reservations",
  "/admin/reservations/new",
  "/admin/calendar",
  "/admin/notifications",
  "/admin/rooms",
  `/admin/rooms/${ROOMS.conference.id}`,
  "/admin/rooms/new",
  "/admin/ministries",
  "/admin/users",
  "/admin/settings",
  "/admin/audit",
];

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page) {
  for (const width of [320, 768, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
  }
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} mode`, () => {
    test.use({ colorScheme });

    for (const path of PUBLIC_PAGES) {
      test(`public ${path}`, async ({ page }) => {
        await page.goto(path, { waitUntil: "networkidle" });
        await expectAccessible(page);
        if (colorScheme === "light") await expectNoHorizontalScroll(page);
      });
    }

    for (const path of ADMIN_PAGES) {
      test(`admin ${path}`, async ({ page, context }) => {
        await signInAs(context, "superAdmin");
        await page.goto(path, { waitUntil: "networkidle" });
        await expect(page.locator("#admin-main")).toBeVisible();
        await expectAccessible(page);
        if (colorScheme === "light") await expectNoHorizontalScroll(page);
      });
    }
  });
}

test("security headers are sent", async ({ request }) => {
  const response = await request.get("/");
  const headers = response.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-powered-by"]).toBeUndefined();
  const admin = await request.get("/admin/login");
  expect(admin.headers()["x-robots-tag"]).toContain("noindex");
});
