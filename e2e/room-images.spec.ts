import { expect, test } from "@playwright/test";

import { ROOMS } from "./support/accounts";
import { signInAs } from "./support/helpers";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("the Add Room page accepts and compresses a multi-image selection", async ({ browser }) => {
  const context = await browser.newContext();
  await signInAs(context, "superAdmin");
  const page = await context.newPage();
  await page.goto("/admin/rooms/new");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "front.png", mimeType: "image/png", buffer: PNG },
    { name: "inside.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(page.getByText("Primary image", { exact: true })).toBeVisible();
  await expect(page.getByText("Image 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove image 2" }).click();
  await expect(page.getByText("Image 2", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/up to 10 MB each/i)).toBeVisible();
  await context.close();
});

test("a Super Admin can choose which image is the primary image", async ({ browser }) => {
  const context = await browser.newContext();
  await signInAs(context, "superAdmin");
  const page = await context.newPage();
  const editor = `/admin/rooms/${ROOMS.hall.id}`;
  const primarySource = async () => {
    await page.goto(`/rooms/${ROOMS.hall.slug}`);
    return page.locator("#room-gallery-main-image img").getAttribute("src");
  };
  const makePrimaryAndSave = async (imageNumber: number) => {
    await page.goto(editor);
    await page.getByRole("button", { name: `Make image ${imageNumber} the primary image` }).click();
    await expect(page.getByRole("status").filter({ hasText: `Image ${imageNumber} is now the primary image` })).toHaveCount(1);
    await expect(page.getByText("Primary image", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /save/i }).last().click();
    await expect(page.getByText("Room saved.")).toBeVisible();
  };

  expect(decodeURIComponent((await primarySource()) ?? "")).toContain("front.png");
  await makePrimaryAndSave(2);
  expect(decodeURIComponent((await primarySource()) ?? "")).toContain("side.png");

  // Restore the shared fixture's order.
  await makePrimaryAndSave(2);
  expect(decodeURIComponent((await primarySource()) ?? "")).toContain("front.png");
  await context.close();
});
