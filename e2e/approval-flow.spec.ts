import { expect, test, type Page } from "@playwright/test";

import { ROOMS } from "./support/accounts";
import { daysFromToday, goToReview, guest, newVisitor, referenceOnPage, signInAs } from "./support/helpers";

/** Opens the single reservation left after searching by reference. */
async function openOnlyResult(page: Page) {
  const links = page
    .locator('main a[href^="/admin/reservations/"]:not([href$="/new"]):not([href*="/export/"])')
    .filter({ visible: true });
  await expect(links).toHaveCount(1);
  await links.click();
  await expect(page).toHaveURL(/\/admin\/reservations\/[0-9a-f-]{36}$/);
}

test("request → staff approval → the guest sees it approved", async ({ browser }) => {
  // Guest submits a request for an approval-required room.
  const guestContext = await newVisitor(browser);
  const guestPage = await guestContext.newPage();
  const g = guest({ attendance: 150, purpose: "Community health fair" });
  await goToReview(guestPage, { room: ROOMS.hall.slug, date: daysFromToday(12), start: "10:00", end: "12:00", guest: g });
  await expect(guestPage.getByText("Approval Required").first()).toBeVisible();
  // Over capacity is a warning, never a block.
  await expect(guestPage.getByText(/configured for a maximum of 120 people/)).toBeVisible();
  await guestPage.getByRole("button", { name: "Submit Request" }).click();
  await expect(guestPage.getByRole("heading", { name: "Reservation Request Submitted" })).toBeVisible();
  await expect(guestPage.getByText("Pending").first()).toBeVisible();
  const reference = await referenceOnPage(guestPage);

  // Staff finds and approves it.
  const staffContext = await browser.newContext();
  await signInAs(staffContext, "admin");
  const staff = await staffContext.newPage();
  await staff.goto(`/admin/reservations?q=${reference}`);
  await openOnlyResult(staff);
  await expect(staff.getByText(reference).first()).toBeVisible();

  // Emails were queued and processed (not sent: no email provider in tests).
  await expect(staff.getByText("Request received (requester)")).toBeVisible();
  await expect(staff.getByText("Not sent: email delivery isn't configured.").first()).toBeVisible();

  await staff.getByRole("button", { name: "Approve", exact: true }).click();
  const dialog = staff.getByRole("dialog");
  await dialog.getByLabel("Message to the requester").fill("Please use the side entrance.");
  await dialog.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(staff.getByText("Reservation approved.")).toBeVisible();
  await expect(staff.getByText("Approved (requester)")).toBeVisible();

  // Emails go out right after the response, so the log catches up on the next load.
  const retry = staff.getByRole("button", { name: "Send again: Approved (requester)" });
  await expect(async () => {
    await staff.reload();
    await expect(retry).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await retry.click();
  await expect(staff.getByText("Email queued to send again.")).toBeVisible();

  // The guest's page now shows the approval and the staff message.
  await guestPage.goto(`/reservation/${reference}`);
  await expect(guestPage.getByText("Approved").first()).toBeVisible();
  await expect(guestPage.getByText("Please use the side entrance.")).toBeVisible();

  await staffContext.close();
  await guestContext.close();
});

test("staff decline releases the time and notes stay private", async ({ browser }) => {
  const guestContext = await newVisitor(browser);
  const guestPage = await guestContext.newPage();
  const date = daysFromToday(13);
  await goToReview(guestPage, { room: ROOMS.hall.slug, date, start: "18:00", end: "19:00", guest: guest() });
  await guestPage.getByRole("button", { name: "Submit Request" }).click();
  const reference = await referenceOnPage(guestPage);

  const staffContext = await browser.newContext();
  await signInAs(staffContext, "superAdmin");
  const staff = await staffContext.newPage();
  await staff.goto(`/admin/reservations?q=${reference}`);
  await openOnlyResult(staff);
  await staff.getByRole("button", { name: "Decline", exact: true }).click();
  const dialog = staff.getByRole("dialog");
  await dialog.getByLabel("Message to the requester").fill("The hall is being painted that week.");
  await dialog.getByLabel("Private staff note").fill("Internal: painting crew booked");
  await dialog.getByRole("button", { name: "Decline request" }).click();
  await expect(staff.getByText("Reservation declined.")).toBeVisible();

  await guestPage.goto(`/reservation/${reference}`);
  await expect(guestPage.getByText("Declined").first()).toBeVisible();
  await expect(guestPage.getByText("The hall is being painted that week.")).toBeVisible();
  await expect(guestPage.getByText(/painting crew/)).toHaveCount(0);

  // Declined requests no longer hold the time.
  await guestPage.goto(`/reserve?room=${ROOMS.hall.slug}&date=${date}`);
  await expect(guestPage.locator("#reserve-start")).toBeEnabled();
  await expect(guestPage.locator('#reserve-start option[value="18:00"]')).toHaveCount(1);

  await staffContext.close();
  await guestContext.close();
});
