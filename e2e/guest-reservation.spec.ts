import { expect, test } from "@playwright/test";

import { ROOMS } from "./support/accounts";
import { daysFromToday, goToReview, guest, newVisitor, REFERENCE, referenceOnPage } from "./support/helpers";

test.describe("guest reservation (instant room)", () => {
  test("requires explicit Privacy Policy and Terms acceptance before submission", async ({ browser }) => {
    const context = await newVisitor(browser);
    const page = await context.newPage();
    await goToReview(page, {
      room: ROOMS.conference.slug,
      date: daysFromToday(27),
      start: "19:00",
      end: "20:00",
      guest: guest(),
    });

    const consent = page.getByRole("checkbox", { name: /I have read and accept/ });
    await consent.uncheck();
    await page.getByRole("button", { name: "Reserve Room" }).click();
    await expect(page.getByText("Please accept the Privacy Policy and Terms of Service to continue.")).toBeVisible();
    await expect(consent).toBeFocused();
    await expect(page).toHaveURL(/\/reserve/);

    const reservationForm = page.locator("#main");
    await expect(reservationForm.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("target", "_blank");
    await expect(reservationForm.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("target", "_blank");
    await consent.check();
    await page.getByRole("button", { name: "Reserve Room" }).click();
    await expect(page.getByRole("heading", { name: "Room Reserved" })).toBeVisible();
    await context.close();
  });

  test("room cards expose distinct selected and keyboard-focus states", async ({ page }) => {
    await page.goto("/reserve");
    const room = page.getByRole("radio", { name: ROOMS.conference.name });
    const card = room.locator("xpath=..");

    await expect(card).toHaveAttribute("data-selected", "false");
    await card.click();
    await expect(room).toBeChecked();
    await expect(card).toHaveAttribute("data-selected", "true");
    await room.focus();
    await expect(room).toBeFocused();
  });

  test("reserves, manages with the private link cookie, and cancels", async ({ browser }) => {
    const context = await newVisitor(browser);
    const page = await context.newPage();
    const date = daysFromToday(6);
    const g = guest();

    await goToReview(page, { room: ROOMS.conference.slug, date, start: "14:00", end: "15:30", guest: g });
    await expect(page.getByText("Instant Reservation")).toBeVisible();
    await expect(page.getByText("(512) 555-0123")).toBeVisible();
    await page.getByRole("button", { name: "Reserve Room" }).click();

    await expect(page).toHaveURL(/\/reservation\/RAR-/);
    await expect(page.getByRole("heading", { name: "Room Reserved" })).toBeVisible();
    const reference = await referenceOnPage(page);
    // The token lives in an HttpOnly cookie, never in the address bar.
    expect(page.url()).not.toContain("token=");
    await expect(page.getByText(g.purpose)).toBeVisible();

    // Cancel as the guest.
    await page.getByRole("button", { name: "Cancel reservation" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading", { name: "Cancel this reservation?" })).toBeVisible();
    await dialog.getByRole("button", { name: "Yes, cancel it" }).click();
    await expect(page.getByText("You cancelled this reservation.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Room Reserved" })).toHaveCount(0);

    // The released time can be reserved again.
    await page.goto(`/reserve?room=${ROOMS.conference.slug}&date=${date}`);
    await expect(page.locator("#reserve-start")).toBeEnabled();
    await expect(page.locator('#reserve-start option[value="14:00"]')).toHaveCount(1);

    // Someone without the link can't open it, and learns nothing about it.
    const stranger = await newVisitor(browser);
    const other = await stranger.newPage();
    await other.goto(`/reservation/${reference}`);
    await expect(other.getByRole("heading", { name: "We couldn't open this reservation" })).toBeVisible();
    await expect(other.getByText(g.lastName)).toHaveCount(0);
    await expect(other.getByText(REFERENCE)).toHaveCount(0);

    await stranger.close();
    await context.close();
  });

  test("a reserved time is no longer offered", async ({ browser }) => {
    const context = await newVisitor(browser);
    const page = await context.newPage();
    const date = daysFromToday(7);

    await goToReview(page, { room: ROOMS.conference.slug, date, start: "09:00", end: "10:00", guest: guest() });
    await page.getByRole("button", { name: "Reserve Room" }).click();
    await expect(page.getByRole("heading", { name: "Room Reserved" })).toBeVisible();

    await page.goto(`/reserve?room=${ROOMS.conference.slug}&date=${date}`);
    await expect(page.locator("#reserve-start")).toBeEnabled();
    await expect(page.locator('#reserve-start option[value="09:00"]')).toHaveCount(0);
    await expect(page.locator('#reserve-start option[value="09:30"]')).toHaveCount(0);
    await expect(page.locator('#reserve-start option[value="10:00"]')).toHaveCount(1);
    await context.close();
  });

  test("shows validation messages and keeps the visitor on the step", async ({ browser }) => {
    const context = await newVisitor(browser);
    const page = await context.newPage();
    await page.goto(`/reserve?room=${ROOMS.conference.slug}&date=${daysFromToday(8)}`);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Please choose a start time.")).toBeVisible();
    await expect(page.locator("#reserve-start")).toBeFocused();

    await page.locator("#reserve-start").selectOption("11:00");
    await page.locator("#reserve-end").selectOption("12:00");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.locator("#email").fill("not-an-email");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("#firstName")).toBeFocused();
    await expect(page.locator("#email")).toHaveAttribute("aria-invalid", "true");
    await context.close();
  });

  test("an unavailable room can't be reserved", async ({ page }) => {
    await page.goto(`/rooms/${ROOMS.classroom.slug}`);
    await expect(page.getByText("Closed for carpet cleaning this week.")).toBeVisible();
    await page.goto("/reserve");
    await expect(page.getByText(ROOMS.classroom.name)).toHaveCount(0);
  });
});

test.describe("refreshing the 3-step form", () => {
  async function fillSchedule(page: import("@playwright/test").Page, date: string, start: string, end: string) {
    await page.goto(`/reserve?room=${ROOMS.conference.slug}&date=${date}`);
    await expect(page.locator("#reserve-start")).toBeEnabled();
    await page.locator("#reserve-start").selectOption(start);
    await page.locator("#reserve-end").selectOption(end);
  }

  test("keeps the answers and the step, never the consent, and still lets the visitor submit right away", async ({ browser }) => {
    const context = await newVisitor(browser);
    const page = await context.newPage();
    const date = daysFromToday(15);
    const g = guest({ ministry: "Prayer Ministry", purpose: "Refresh test", attendance: 9 });

    await fillSchedule(page, date, "08:00", "09:00");
    const formShownAt = Date.now();
    await expect(page.getByText("We restored what you had entered")).toHaveCount(0);

    // Refresh on step 1.
    await page.reload();
    await expect(page.getByText("We restored what you had entered")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Room & time" })).toBeVisible();
    await expect(page.locator("#reserve-start")).toHaveValue("08:00");
    await expect(page.locator("#reserve-end")).toHaveValue("09:00");
    await page.getByRole("button", { name: "Continue" }).click();

    // Refresh on step 2 with details typed.
    await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
    await page.locator("#firstName").fill(g.firstName);
    await page.locator("#lastName").fill(g.lastName);
    await page.locator("#email").fill(g.email);
    await page.locator("#phone").fill(g.phone);
    await page.locator("#ministryId").selectOption({ label: g.ministry });
    await page.locator("#purpose").fill(g.purpose);
    await page.locator("#estimatedAttendance").fill(String(g.attendance));
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
    await expect(page.locator("#firstName")).toHaveValue(g.firstName);
    await expect(page.locator("#lastName")).toHaveValue(g.lastName);
    await expect(page.locator("#email")).toHaveValue(g.email);
    await expect(page.locator("#phone")).toHaveValue(g.phone);
    await expect(page.locator("#ministryId")).toHaveValue(/[0-9a-f-]{36}/);
    await expect(page.locator("#purpose")).toHaveValue(g.purpose);
    await expect(page.locator("#estimatedAttendance")).toHaveValue(String(g.attendance));
    await page.getByRole("button", { name: "Continue" }).click();

    // Refresh on step 3: still there, with consent to be given again.
    await expect(page.getByRole("heading", { name: "Review & submit" })).toBeVisible();
    await page.getByRole("checkbox", { name: /I have read and accept/ }).check();
    // The server refuses forms completed within 3 s of first being shown (bot defense). Let that
    // time pass *before* the refresh: a refresh must not restart the clock, so a prompt submit
    // right after it is still accepted.
    await page.waitForTimeout(Math.max(0, 3400 - (Date.now() - formShownAt)));
    await page.reload();
    await expect(page.getByRole("heading", { name: "Review & submit" })).toBeVisible();
    await expect(page.getByText(g.email)).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /I have read and accept/ })).not.toBeChecked();

    // The saved form-shown time means a prompt submit after a refresh isn't mistaken for a bot.
    await page.getByRole("checkbox", { name: /I have read and accept/ }).check();
    await page.getByRole("button", { name: "Reserve Room" }).click();
    await expect(page.getByRole("heading", { name: "Room Reserved" })).toBeVisible();

    // A submitted reservation leaves nothing behind.
    await page.goto(`/reserve?room=${ROOMS.conference.slug}`);
    await expect(page.getByRole("heading", { name: "Room & time" })).toBeVisible();
    await page.reload();
    await expect(page.getByText("We restored what you had entered")).toHaveCount(0);
    await context.close();
  });

  test("Start over clears it, and a different pre-filled link isn't overridden by an old draft", async ({ browser }) => {
    const context = await newVisitor(browser);
    const page = await context.newPage();
    const date = daysFromToday(16);

    await fillSchedule(page, date, "10:00", "11:00");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.locator("#firstName").fill("Casey");
    await page.reload();
    await expect(page.locator("#firstName")).toHaveValue("Casey");

    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.getByRole("heading", { name: "Room & time" })).toBeVisible();
    await expect(page.getByText("We restored what you had entered")).toHaveCount(0);
    await expect(page.locator("#reserve-start")).toHaveValue("");
    await page.reload();
    await expect(page.getByText("We restored what you had entered")).toHaveCount(0);

    // A draft started from one link doesn't hijack a different link.
    await fillSchedule(page, date, "13:00", "14:00");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.locator("#firstName").fill("Casey");
    const otherDate = daysFromToday(17);
    await page.goto(`/reserve?room=${ROOMS.conference.slug}&date=${otherDate}`);
    await expect(page.getByText("We restored what you had entered")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Room & time" })).toBeVisible();
    await page.goto(`/reserve?room=${ROOMS.conference.slug}&date=${otherDate}`);
    await expect(page.getByText("We restored what you had entered")).toHaveCount(0);
    await context.close();
  });
});
