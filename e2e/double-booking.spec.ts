import { expect, test } from "@playwright/test";

import { ROOMS } from "./support/accounts";
import { daysFromToday, goToReview, guest, newVisitor } from "./support/helpers";

/**
 * Two people submit the same room and time at the same moment. The database exclusion
 * constraint lets exactly one through; the other gets a clear conflict message and is
 * sent back to pick another time, with the taken slot removed from the list.
 */
test("simultaneous submissions for the same time: exactly one wins", async ({ browser }) => {
  const date = daysFromToday(9);
  const [a, b] = await Promise.all([newVisitor(browser), newVisitor(browser)]);
  const [pageA, pageB] = await Promise.all([a.newPage(), b.newPage()]);

  // Overlapping, not identical, ranges: 13:00–14:30 vs 14:00–15:00.
  await goToReview(pageA, { room: ROOMS.conference.slug, date, start: "13:00", end: "14:30", guest: guest() });
  await goToReview(pageB, { room: ROOMS.conference.slug, date, start: "14:00", end: "15:00", guest: guest() });

  await Promise.all([
    pageA.getByRole("button", { name: "Reserve Room" }).click(),
    pageB.getByRole("button", { name: "Reserve Room" }).click(),
  ]);

  const outcome = async (page: typeof pageA) => {
    const won = page.getByRole("heading", { name: "Room Reserved" });
    const lost = page.getByText("That room was just reserved or requested by someone else for this time.");
    await expect(won.or(lost)).toBeVisible();
    return (await won.isVisible()) ? "won" : "lost";
  };
  const results = await Promise.all([outcome(pageA), outcome(pageB)]);
  expect([...results].sort()).toEqual(["lost", "won"]);

  // The loser is back on step 1 with fresh availability.
  const loser = results[0] === "lost" ? pageA : pageB;
  await expect(loser.getByRole("heading", { name: "Room & time" })).toBeVisible();
  await expect(loser.locator('#reserve-start option[value="14:00"]')).toHaveCount(0);

  await a.close();
  await b.close();
});

test("a shared link to a time that's since been taken is caught before submitting", async ({ browser }) => {
  const date = daysFromToday(10);
  const first = await newVisitor(browser);
  const page = await first.newPage();
  await goToReview(page, { room: ROOMS.conference.slug, date, start: "16:00", end: "17:00", guest: guest() });
  await page.getByRole("button", { name: "Reserve Room" }).click();
  await expect(page.getByRole("heading", { name: "Room Reserved" })).toBeVisible();

  // Someone else opens a pre-filled link for an overlapping time. (The database constraint
  // itself is covered by supabase/tests/reservation-rules.test.ts.)
  const second = await newVisitor(browser);
  const late = await second.newPage();
  await late.goto(`/reserve?room=${ROOMS.conference.slug}&date=${date}&start=16:30&end=17:30`);
  await expect(late.locator("#reserve-start")).toBeEnabled();
  await late.getByRole("button", { name: "Continue" }).click();
  await expect(late.getByText("That start time isn't available. Please choose another.")).toBeVisible();
  await expect(late.getByRole("heading", { name: "Room & time" })).toBeVisible();

  await first.close();
  await second.close();
});
