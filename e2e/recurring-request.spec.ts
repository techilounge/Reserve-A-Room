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

test("a refresh keeps what the visitor typed, except consent, and Start over clears it", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/recurring-request");
  const preferredDate = daysFromToday(21);
  await page.locator("#roomId").selectOption(ROOMS.hall.id);
  await page.locator("#preferredStartDate").fill(preferredDate);
  await page.locator("#start").selectOption("10:00");
  await page.locator("#end").selectOption("12:00");
  await page.locator("#recurrenceDescription").fill("Every other Friday evening");
  await page.locator("#firstName").fill("Morgan");
  await page.locator("#email").fill("morgan@example.org");
  await page.locator("#estimatedAttendance").fill("40");
  await page.locator("#legalAccepted").check();
  await expect(page.getByText("We restored what you had entered")).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("We restored what you had entered")).toBeVisible();
  await expect(page.locator("#roomId")).toHaveValue(ROOMS.hall.id);
  await expect(page.locator("#preferredStartDate")).toHaveValue(preferredDate);
  await expect(page.locator("#start")).toHaveValue("10:00");
  await expect(page.locator("#end")).toHaveValue("12:00");
  await expect(page.locator("#recurrenceDescription")).toHaveValue("Every other Friday evening");
  await expect(page.locator("#firstName")).toHaveValue("Morgan");
  await expect(page.locator("#email")).toHaveValue("morgan@example.org");
  await expect(page.locator("#estimatedAttendance")).toHaveValue("40");
  // Consent is never restored: it must be given again.
  await expect(page.locator("#legalAccepted")).not.toBeChecked();

  // Changes after a restore are saved too.
  await page.locator("#lastName").fill("Lee");
  await page.reload();
  await expect(page.locator("#lastName")).toHaveValue("Lee");

  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.locator("#firstName")).toHaveValue("");
  await expect(page.locator("#roomId")).toHaveValue("");
  await expect(page.getByText("We restored what you had entered")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#firstName")).toHaveValue("");
  await expect(page.getByText("We restored what you had entered")).toHaveCount(0);

  // The draft stays in this tab's session only: a new context starts empty.
  await page.locator("#firstName").fill("Morgan");
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto("/recurring-request");
  await expect(otherPage.locator("#firstName")).toHaveValue("");
  await other.close();
  await context.close();
});

test("the attendance field warns, without blocking, when it exceeds the selected room's capacity", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/recurring-request");
  const warning = page.getByText("Room Capacity Warning");

  // No room yet: no capacity hint, no warning.
  await page.locator("#estimatedAttendance").fill("500");
  await expect(warning).toHaveCount(0);
  await expect(page.locator("#estimatedAttendance-description")).toHaveCount(0);

  await page.locator("#roomId").selectOption(ROOMS.conference.id);
  await expect(page.locator("#estimatedAttendance-description")).toHaveText(`${ROOMS.conference.name} is set up for up to 15 people.`);
  await expect(warning).toBeVisible();
  await expect(page.getByText("maximum of 15 people, but you entered 500 attendees")).toBeVisible();

  await page.locator("#estimatedAttendance").fill("15");
  await expect(warning).toHaveCount(0);
  await page.locator("#estimatedAttendance").fill("16");
  await expect(warning).toBeVisible();

  // A bigger room clears it; switching back restores it.
  await page.locator("#roomId").selectOption(ROOMS.hall.id);
  await expect(page.locator("#estimatedAttendance-description")).toHaveText(`${ROOMS.hall.name} is set up for up to 120 people.`);
  await expect(warning).toHaveCount(0);
  await page.locator("#roomId").selectOption(ROOMS.conference.id);
  await expect(warning).toBeVisible();

  // It's a warning only: the request can still be sent. (Consent is checked on the next
  // submit, so the form reports a different problem rather than a capacity error.)
  await page.waitForTimeout(3100); // the minimum fill time, as in the main flow
  await page.getByRole("button", { name: "Send recurring request" }).click();
  await expect(page.locator("#legalAccepted-error")).toBeVisible();
  await expect(page.locator("#estimatedAttendance-error")).toHaveCount(0);
  await context.close();
});
