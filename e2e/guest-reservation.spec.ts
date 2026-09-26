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
