import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { addDaysToLocalDate, todayInZone, type LocalDate } from "@/lib/datetime";

import { TEST_ACCOUNTS } from "./accounts";

const MOCK_URL = `http://localhost:${process.env.MOCK_SUPABASE_PORT ?? 54400}`;
export const CHURCH_TZ = "America/Chicago";

/** A church-local date `days` from today. Tests use distinct days so they never collide. */
export function daysFromToday(days: number): LocalDate {
  return addDaysToLocalDate(todayInZone(CHURCH_TZ), days);
}

let ipCounter = 0;
/** A browser context that looks like a separate visitor (own IP → own rate-limit bucket). */
export async function newVisitor(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}): Promise<BrowserContext> {
  ipCounter += 1;
  const ip = `10.${Math.floor(Math.random() * 200) + 1}.${ipCounter % 250}.${Math.floor(Math.random() * 250) + 1}`;
  return browser.newContext({ ...options, extraHTTPHeaders: { "x-forwarded-for": ip } });
}

/** Signs a context in as a staff test account (session cookie issued by the mock). */
export async function signInAs(context: BrowserContext, who: keyof typeof TEST_ACCOUNTS) {
  const response = await fetch(`${MOCK_URL}/qa/cookie?email=${encodeURIComponent(TEST_ACCOUNTS[who].email)}`);
  const value = await response.text();
  await context.addCookies([{ name: "sb-localhost-auth-token", value, domain: "localhost", path: "/" }]);
}

export type Guest = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  ministry: string;
  purpose: string;
  attendance: number;
};

export function guest(overrides: Partial<Guest> = {}): Guest {
  const id = Math.random().toString(36).slice(2, 8);
  return {
    firstName: "Jordan",
    lastName: `Tester-${id}`,
    email: `jordan.${id}@example.org`,
    phone: "(512) 555-0123",
    ministry: "Music Ministry",
    purpose: "Choir rehearsal",
    attendance: 8,
    ...overrides,
  };
}

/**
 * Walks the guest wizard: step 1 via the pre-fill link, then picks the times with the
 * real selects, fills step 2, and stops on the review step (returns when it's shown).
 */
export async function goToReview(page: Page, opts: { room: string; date: LocalDate; start: string; end: string; guest: Guest }) {
  await page.goto(`/reserve?room=${opts.room}&date=${opts.date}`);
  const startedAt = Date.now();
  const start = page.locator("#reserve-start");
  await expect(start).toBeEnabled();
  await start.selectOption(opts.start);
  await page.locator("#reserve-end").selectOption(opts.end);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
  const g = opts.guest;
  await page.locator("#firstName").fill(g.firstName);
  await page.locator("#lastName").fill(g.lastName);
  await page.locator("#email").fill(g.email);
  await page.locator("#phone").fill(g.phone);
  await page.locator("#ministryId").selectOption({ label: g.ministry });
  await page.locator("#purpose").fill(g.purpose);
  await page.locator("#estimatedAttendance").fill(String(g.attendance));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Review & submit" })).toBeVisible();
  await page.getByRole("checkbox", { name: /I have read and accept/ }).check();

  // The server rejects forms completed faster than a person could (bot defense).
  const wait = 3200 - (Date.now() - startedAt);
  if (wait > 0) await page.waitForTimeout(wait);
}

export const REFERENCE = /RAR-\d{8}-[0-9A-HJKMNP-TV-Z]{4}/;

/** The reference code shown on a guest reservation page. */
export async function referenceOnPage(page: Page): Promise<string> {
  const text = await page.getByText(REFERENCE).first().textContent();
  const match = text?.match(REFERENCE);
  if (!match) throw new Error("No reference code on the page");
  return match[0];
}
