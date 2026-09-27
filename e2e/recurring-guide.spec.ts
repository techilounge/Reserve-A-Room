import { expect, test } from "@playwright/test";

import { signInAs } from "./support/helpers";

test("Admins can follow every recurring-reservation scenario from the sidebar guide", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await signInAs(context, "admin");
  const page = await context.newPage();
  await page.goto("/admin/recurring-guide");

  await expect(page.getByRole("heading", { level: 1, name: "Recurring Reservations How-To Guide" })).toBeVisible();
  const guideLink = page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Recurring Guide" });
  await expect(guideLink).toHaveAttribute("aria-current", "page");

  const chooser = page.getByRole("navigation", { name: "Recurring schedule examples" });
  await expect(chooser.getByRole("link")).toHaveCount(8);
  for (const heading of [
    "Every day",
    "Every few days",
    "Every weekday",
    "Weekly on one or more days",
    "Monthly on a calendar date",
    "Monthly on a weekday position",
    "Yearly on a calendar date",
    "Yearly on a weekday position",
  ]) {
    await expect(page.getByRole("heading", { level: 3, name: heading, exact: true })).toBeVisible();
  }

  await expect(page.getByText("The second and fourth Saturdays", { exact: false })).toBeVisible();
  await expect(page.getByText("earlier of one year or 50 occurrences", { exact: false })).toBeVisible();

  await page.getByRole("link", { name: "Create recurring reservation" }).first().click();
  await expect(page).toHaveURL(/\/admin\/reservations\/new#recurrence$/);
  await expect(page.locator("#recurrence")).toBeVisible();

  await context.close();
});

test("Super Admins can open the recurring guide from the mobile More menu", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await signInAs(context, "superAdmin");
  const page = await context.newPage();
  await page.goto("/admin/recurring-guide");

  await page.getByRole("button", { name: "More admin navigation" }).click();
  const sheet = page.getByRole("dialog");
  const guideLink = sheet.getByRole("link", { name: "Recurring Guide" });
  await expect(guideLink).toBeVisible();
  await expect(guideLink).toHaveAttribute("aria-current", "page");

  await context.close();
});
