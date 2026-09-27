import { expect, test } from "@playwright/test";

import { ROOMS } from "./support/accounts";

test("room gallery thumbnails select the displayed image", async ({ page }) => {
  await page.goto(`/rooms/${ROOMS.hall.slug}`);

  const firstThumbnail = page.getByRole("button", { name: "Show image 1 of 2" });
  const secondThumbnail = page.getByRole("button", { name: "Show image 2 of 2" });
  const mainImage = page.locator("#room-gallery-main-image img");

  await expect(firstThumbnail).toHaveAttribute("aria-pressed", "true");
  await expect(secondThumbnail).toHaveAttribute("aria-pressed", "false");
  await expect(mainImage).toHaveAttribute("alt", "Photo of Fellowship Hall, image 1 of 2");

  await secondThumbnail.click();
  await expect(secondThumbnail).toHaveAttribute("aria-pressed", "true");
  await expect(firstThumbnail).toHaveAttribute("aria-pressed", "false");
  await expect(mainImage).toHaveAttribute("alt", "Photo of Fellowship Hall, image 2 of 2");
  await expect(page.getByText("Showing image 2 of 2.")).toHaveCount(1);

  await firstThumbnail.focus();
  await firstThumbnail.press("Enter");
  await expect(firstThumbnail).toHaveAttribute("aria-pressed", "true");
  await expect(mainImage).toHaveAttribute("alt", "Photo of Fellowship Hall, image 1 of 2");
});
