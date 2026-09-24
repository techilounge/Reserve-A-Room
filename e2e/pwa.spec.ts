import { expect, test } from "@playwright/test";

test("manifest and icons are valid", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/", theme_color: "#031e47" });
  expect(manifest.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
  for (const icon of manifest.icons as { src: string }[]) {
    const response = await request.get(icon.src);
    expect(response.status(), icon.src).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
  }
  const sw = await request.get("/sw.js?v=test");
  expect(sw.headers()["cache-control"]).toContain("no-cache");
});

test("offline: pages fall back to the offline screen; nothing private is cached", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the worker

  await context.setOffline(true);
  for (const path of ["/rooms", "/availability", "/reserve"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    // Fully styled (the CSS and fonts were pre-cached with the page).
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("Inter");
  }
  // Private reservation links are never handled by the worker.
  await expect(page.goto("/reservation/RAR-20260101-AAAA")).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
  await context.setOffline(false);
  await page.goto("/");

  const cachedPaths = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const key of await caches.keys()) {
      for (const request of await (await caches.open(key)).keys()) paths.push(new URL(request.url).pathname);
    }
    return paths;
  });
  expect(cachedPaths).toContain("/offline");
  expect(cachedPaths.filter((p) => !p.startsWith("/_next/static/") && !p.startsWith("/branding/") && !p.startsWith("/icons/"))).toEqual([
    "/offline",
  ]);
});
