import { expect, test } from "@playwright/test";

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
  await expect(page.getByText(/maximum 2 MB per source image/i)).toBeVisible();
  await context.close();
});
