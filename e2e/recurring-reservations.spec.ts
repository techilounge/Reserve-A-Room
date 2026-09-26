import { expect, test, type Page } from "@playwright/test";

import { addMonthsToLocalDate, formatShortDate, localDateToUtcMidnight } from "@/lib/datetime";

import { ROOMS } from "./support/accounts";
import { daysFromToday, goToReview, guest, signInAs } from "./support/helpers";

async function chooseDate(page: Page, trigger: string, value: string) {
  const date = localDateToUtcMidnight(value);
  const selector = `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
  await page.locator(trigger).click();
  await page.locator(`[data-slot="calendar"] button[data-day="${selector}"]`).click();
}

async function fillStaffReservation(
  page: Page,
  options: { roomId: string; date: string; start: string; end: string; email?: string },
) {
  await page.goto("/admin/reservations/new");
  await expect(page.locator("form")).toHaveAttribute("data-interactive", "true");
  await page.locator("#roomId").selectOption(options.roomId);
  await chooseDate(page, "#date", options.date);
  await expect(page.locator("#start")).toBeEnabled();
  await page.locator("#start").selectOption(options.start);
  await page.locator("#end").selectOption(options.end);
  await page.locator("#firstName").fill("Katherine");
  await page.locator("#lastName").fill("Johnson");
  await page.locator("#email").fill(options.email ?? `katherine.${Math.random().toString(36).slice(2)}@example.org`);
  await page.locator("#phone").fill("(512) 555-0199");
  await page.locator("#ministryId").selectOption({ label: "Music Ministry" });
  await page.locator("#purpose").fill("Recurring ministry planning");
  await page.locator("#estimatedAttendance").fill("12");
}

test("staff creates and ends a weekly recurring reservation series", async ({ browser }) => {
  const context = await browser.newContext();
  await signInAs(context, "admin");
  const page = await context.newPage();
  const startDate = daysFromToday(8);

  await fillStaffReservation(page, {
    roomId: ROOMS.conference.id,
    date: startDate,
    start: "14:00",
    end: "15:00",
  });
  await page.locator("#repeat").selectOption("weekly");
  await page.getByRole("button", { name: "Preview schedule" }).click();

  await expect(page.getByText(/Every week on Saturday, 2:00 PM/)).toBeVisible();
  await expect(page.getByText(`${formatShortDate(startDate)} · Available`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create recurring series" }).click();

  await expect(page).toHaveURL(/\/admin\/reservation-series\/[0-9a-f-]+\?created=1$/);
  await expect(page.getByRole("heading", { name: ROOMS.conference.name })).toBeVisible();
  await expect(page.getByText("Recurring series created. All dates shown below are confirmed.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Confirmed occurrences" })).toBeVisible();

  await page.getByRole("button", { name: "End series" }).click();
  await page.getByRole("button", { name: "End future generation" }).click();
  await expect(page.getByText("Ended", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "End series" })).toHaveCount(0);
  await context.close();
});

test("staff creates a second-and-fourth-Saturday monthly series and sees its boundaries", async ({ browser }) => {
  const context = await browser.newContext();
  await signInAs(context, "superAdmin");
  const page = await context.newPage();

  await fillStaffReservation(page, {
    roomId: ROOMS.hall.id,
    date: daysFromToday(8),
    start: "14:00",
    end: "15:00",
  });
  await page.locator("#repeat").selectOption("monthly_nth_weekday");
  await page.locator("#recurrence-ordinal").selectOption("2");
  await page.getByRole("button", { name: "Add week of month" }).click();
  await page.locator("#recurrence-ordinal-1").selectOption("4");
  await page.getByRole("button", { name: "Preview schedule" }).click();
  await expect(page.getByText(/The second and fourth Saturdays of every month, 2:00 PM/)).toBeVisible();
  const seriesBoundaries = page.locator("dl");
  await expect(seriesBoundaries.getByText("Start date").locator("..")).toContainText(formatShortDate(daysFromToday(8)));
  await expect(seriesBoundaries.getByText("End date").locator("..")).toContainText(
    `${formatShortDate(addMonthsToLocalDate(daysFromToday(8), 12))} (automatic limit)`,
  );

  await page.getByRole("button", { name: "Create recurring series" }).click();
  await expect(page).toHaveURL(/\/admin\/reservation-series\/[0-9a-f-]+\?created=1$/);
  await expect(page.getByRole("heading", { name: ROOMS.hall.name })).toBeVisible();
  await expect(page.getByText(/The second and fourth Saturdays of every month, 2:00 PM/)).toBeVisible();
  await context.close();
});

test("staff previews the expanded daily, weekday, interval, monthly, and yearly rules", async ({ browser }) => {
  const context = await browser.newContext();
  await signInAs(context, "admin");
  const page = await context.newPage();
  const startDate = daysFromToday(8);
  const start = localDateToUtcMidnight(startDate);
  const month = start.getUTCMonth() + 1;
  const day = start.getUTCDate();
  const weekday = start.getUTCDay();
  const ordinal = Math.ceil(day / 7) <= 4 ? Math.ceil(day / 7) : -1;
  const ordinalName = ordinal === -1 ? "last" : ["first", "second", "third", "fourth"][ordinal - 1];
  const monthName = start.toLocaleString("en-US", { month: "long", timeZone: "UTC" });

  await fillStaffReservation(page, {
    roomId: ROOMS.conference.id,
    date: startDate,
    start: "10:00",
    end: "11:00",
  });

  await page.locator("#repeat").selectOption("daily");
  await page.locator("#recurrence-interval").fill("2");
  await page.getByRole("button", { name: "Preview schedule" }).click();
  await expect(page.getByText(/Every 2 days, 10:00 AM/)).toBeVisible();

  await page.locator("#repeat").selectOption("weekdays");
  await page.getByRole("button", { name: "Preview schedule" }).click();
  await expect(page.getByText(/Every weekday, 10:00 AM/)).toBeVisible();

  await page.locator("#repeat").selectOption("weekly");
  await page.locator("#recurrence-interval").fill("2");
  await page.getByLabel("Sat", { exact: true }).uncheck();
  await page.getByLabel("Mon", { exact: true }).check();
  await page.getByLabel("Wed", { exact: true }).check();
  await page.getByRole("button", { name: "Preview schedule" }).click();
  await expect(page.getByText(/Every 2 weeks on Monday, Wednesday, 10:00 AM/)).toBeVisible();

  await page.locator("#repeat").selectOption("monthly_day");
  await page.locator("#recurrence-interval").fill("3");
  await page.locator("#recurrence-day").fill(String(day));
  await page.getByRole("button", { name: "Preview schedule" }).click();
  await expect(page.getByText(new RegExp(`Day ${day} of every 3 months, 10:00 AM`))).toBeVisible();

  await page.locator("#repeat").selectOption("yearly_date");
  await page.locator("#recurrence-month").selectOption(String(month));
  await page.locator("#recurrence-day").fill(String(day));
  await page.getByRole("button", { name: "Preview schedule" }).click();
  await expect(page.getByText(new RegExp(`Every ${monthName} ${day}, 10:00 AM`))).toBeVisible();

  await page.locator("#repeat").selectOption("yearly_nth_weekday");
  await page.locator("#recurrence-month").selectOption(String(month));
  await page.locator("#recurrence-weekday").selectOption(String(weekday));
  await page.locator("#recurrence-ordinal").selectOption(String(ordinal));
  await page.getByRole("button", { name: "Preview schedule" }).click();
  await expect(
    page.getByText(new RegExp(`The ${ordinalName} ${start.toLocaleString("en-US", { weekday: "long", timeZone: "UTC" })} of ${monthName}, 10:00 AM`)),
  ).toBeVisible();

  await context.close();
});

test("a conflict found after preview prevents the entire series", async ({ browser }) => {
  const adminContext = await browser.newContext();
  await signInAs(adminContext, "admin");
  const admin = await adminContext.newPage();
  const firstDate = daysFromToday(8);
  const conflictDate = daysFromToday(15);

  await fillStaffReservation(admin, {
    roomId: ROOMS.conference.id,
    date: firstDate,
    start: "16:00",
    end: "17:00",
  });
  await admin.locator("#repeat").selectOption("weekly");
  await admin.getByRole("button", { name: "Preview schedule" }).click();
  await expect(admin.getByText(/Every week on Saturday, 4:00 PM/)).toBeVisible();

  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await goToReview(guestPage, {
    room: ROOMS.conference.slug,
    date: conflictDate,
    start: "16:00",
    end: "17:00",
    guest: guest({ email: "conflict@example.org" }),
  });
  await guestPage.getByRole("button", { name: "Reserve Room" }).click();
  await expect(guestPage.getByRole("heading", { name: "Room Reserved" })).toBeVisible();

  await admin.getByRole("button", { name: "Create recurring series" }).click();
  await expect(admin.getByText(/conflict with existing reservations/i)).toBeVisible();
  await expect(admin).toHaveURL(/\/admin\/reservations\/new$/);

  await guestContext.close();
  await adminContext.close();
});

test("recurrence controls remain usable without horizontal overflow on mobile", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await signInAs(context, "superAdmin");
  const page = await context.newPage();
  await page.goto("/admin/reservations/new");
  await expect(page.locator("form")).toHaveAttribute("data-interactive", "true");
  await page.locator("#repeat").selectOption("monthly_nth_weekday");
  await expect(page.locator("#recurrence-weekday")).toBeVisible();
  await expect(page.locator("#recurrence-ordinal")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.close();
});

test("recurring-create and series routes require staff authentication", async ({ page }) => {
  await page.goto("/admin/reservations/new");
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.goto("/admin/reservation-series/00000000-0000-4000-8000-000000000001");
  await expect(page).toHaveURL(/\/admin\/login/);
});
