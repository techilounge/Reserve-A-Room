import { expect, test } from "@playwright/test";

import { signInAs } from "./support/helpers";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

test("public mobile navigation keeps the main destinations within reach", async ({ browser }) => {
  const context = await browser.newContext({ viewport: MOBILE_VIEWPORT });
  const page = await context.newPage();
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link")).toHaveCount(4);
  await expect(navigation.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");

  await navigation.getByRole("link", { name: "Reserve" }).click();
  await expect(page).toHaveURL(/\/reserve$/);
  await expect(navigation.getByRole("link", { name: "Reserve" })).toHaveAttribute("aria-current", "page");

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await context.close();
});

test("public footer credit is a safely isolated external link", async ({ page }) => {
  await page.goto("/");
  const credit = page.getByRole("link", { name: "TechiLounge" });
  await expect(credit).toHaveAttribute("href", "https://techilounge.com");
  await expect(credit).toHaveAttribute("target", "_blank");
  await expect(credit).toHaveAttribute("rel", "noopener noreferrer");
  await expect(credit.locator("xpath=.." )).toContainText("Developed By TechiLounge");
});

test("admin mobile navigation exposes primary tasks and a permission-filtered More sheet", async ({ browser }) => {
  const context = await browser.newContext({ viewport: MOBILE_VIEWPORT });
  await signInAs(context, "superAdmin");
  const page = await context.newPage();
  await page.goto("/admin");

  const navigation = page.getByRole("navigation", { name: "Admin mobile navigation" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByRole("link", { name: "New" })).toHaveAttribute(
    "href",
    "/admin/reservations/new",
  );

  await navigation.getByRole("button", { name: "More admin navigation" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("link", { name: "Notifications" })).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Reservations" })).toHaveCount(0);

  await context.close();
});

test("authenticated staff can move between the public site and admin portal", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await signInAs(context, "superAdmin");
  const page = await context.newPage();
  await page.goto("/admin");

  const brand = page.getByRole("link", { name: /Reserve-A-Room/ }).first();
  await expect(brand).toHaveAttribute("href", "/");
  await brand.click();
  await expect(page).toHaveURL(/localhost:\d+\/$/);

  const mainNavigation = page.getByRole("navigation", { name: "Main" });
  await expect(mainNavigation.getByRole("link", { name: "Admin" })).toBeVisible();
  await mainNavigation.getByRole("link", { name: "Admin" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await context.close();
});

test("privacy and terms pages render the supplied policies and footer routes", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Information We Collect" })).toBeVisible();
  await expect(page.getByText("privacy@stonehillchurch.org", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");

  await page.getByRole("link", { name: "Terms of Service" }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agreement to These Terms" })).toBeVisible();
  await expect(page.getByText("legal@stonehillchurch.org", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
});
