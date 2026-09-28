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
  await expect(page.locator("#start")).toHaveJSProperty("tagName", "SELECT");
  await expect(page.locator('#start option[value="14:00"]')).toHaveText("2:00 PM");
  await page.locator("#roomId").selectOption(ROOMS.conference.id);
  const preferredDate = daysFromToday(30);
  await page.locator("#preferredStartDate").fill(preferredDate);
  await page.locator("#start").selectOption("14:00");
  await page.locator("#end").selectOption("16:00");
  await page.locator("#recurrenceDescription").fill("The second and fourth Saturday of every month through May.");
  await page.locator("#firstName").fill("Jamie");
  const email = `jamie.${Date.now()}@example.org`;
  await page.locator("#email").fill(email);
  await page.locator("#phone").fill("(512) 555-0123");
  await page.locator("#estimatedAttendance").fill("20");
  await page.locator("#purpose").fill("Monthly ministry meeting");
  await page.locator("#requesterNotes").fill("Please call after 5 PM.");
  await page.locator("#legalAccepted").check();
  await page.waitForTimeout(3100);
  await page.getByRole("button", { name: "Send recurring request" }).click();
  await expect(page.locator("#lastName-error")).toBeVisible();
  await expect(page.locator("#roomId")).toHaveValue(ROOMS.conference.id);
  await expect(page.locator("#preferredStartDate")).toHaveValue(preferredDate);
  await expect(page.locator("#start")).toHaveValue("14:00");
  await expect(page.locator("#end")).toHaveValue("16:00");
  await expect(page.locator("#recurrenceDescription")).toHaveValue("The second and fourth Saturday of every month through May.");
  await expect(page.locator("#firstName")).toHaveValue("Jamie");
  await expect(page.locator("#email")).toHaveValue(email);
  await expect(page.locator("#phone")).toHaveValue("(512) 555-0123");
  await expect(page.locator("#estimatedAttendance")).toHaveValue("20");
  await expect(page.locator("#purpose")).toHaveValue("Monthly ministry meeting");
  await expect(page.locator("#requesterNotes")).toHaveValue("Please call after 5 PM.");
  await expect(page.locator("#legalAccepted")).toBeChecked();

  await page.locator("#lastName").fill("Guest");
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
