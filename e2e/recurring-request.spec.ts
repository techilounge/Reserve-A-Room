import { expect, test } from "@playwright/test";

import { ROOMS } from "./support/accounts";
import { daysFromToday, signInAs } from "./support/helpers";

test("guests can reach and submit the focused recurring-request flow", async ({ browser }) => {
  const guest = await browser.newContext();
  const page = await guest.newPage();
  await page.goto("/reserve");
  await expect(page.locator("#main").getByRole("link", { name: "Availability", exact: true })).toHaveAttribute("href", "/availability");
  await page.getByRole("link", { name: "Request recurring dates" }).click();
  await expect(page).toHaveURL(/\/recurring-request$/);
  await page.locator("#roomId").selectOption(ROOMS.conference.id);
  await page.locator("#preferredStartDate").fill(daysFromToday(30));
  await page.locator("#start").fill("14:00");
  await page.locator("#end").fill("16:00");
  await page.locator("#recurrenceDescription").fill("The second and fourth Saturday of every month through May.");
  await page.locator("#firstName").fill("Jamie");
  await page.locator("#lastName").fill("Guest");
  await page.locator("#email").fill(`jamie.${Date.now()}@example.org`);
  await page.locator("#phone").fill("(512) 555-0123");
  await page.locator("#estimatedAttendance").fill("20");
  await page.locator("#purpose").fill("Monthly ministry meeting");
  await page.locator("#legalAccepted").check();
  await page.waitForTimeout(3100);
  await page.getByRole("button", { name: "Send recurring request" }).click();
  await expect(page.getByRole("heading", { name: "Request received" })).toBeVisible();
  const reference = (await page.getByText(/RRR-\d{8}-[0-9A-Z]{4}/).textContent())?.match(/RRR-[0-9A-Z-]+/)?.[0];
  expect(reference).toBeTruthy();
  await guest.close();

  const staff = await browser.newContext();
  await signInAs(staff, "admin");
  const admin = await staff.newPage();
  await admin.goto("/admin/recurring-requests");
  await expect(admin.getByText(reference!, { exact: false })).toBeVisible();
  await expect(admin.getByText("The second and fourth Saturday of every month through May.")).toBeVisible();
  await staff.close();
});
