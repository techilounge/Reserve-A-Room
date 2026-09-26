import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { signInAs } from "./support/helpers";

test("reservation exports require staff authorization", async ({ request }) => {
  for (const format of ["csv", "pdf"]) {
    const response = await request.get(`/admin/reservations/export/${format}`, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain("/admin/login");
  }
});

test("staff can download filtered Excel-compatible CSV and branded PDF files", async ({ browser }) => {
  const context = await browser.newContext();
  await signInAs(context, "admin");

  const csv = await context.request.get("/admin/reservations/export/csv?status=approved");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(csv.headers()["content-disposition"]).toMatch(/attachment; filename="reservations-\d{4}-\d{2}-\d{2}\.csv"/);
  const csvBody = await csv.body();
  expect(csvBody.subarray(0, 3).toString("hex")).toBe("efbbbf");
  expect(csvBody.toString("utf8")).toContain('"Reference","Status"');

  const pdf = await context.request.get("/admin/reservations/export/pdf?status=approved");
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect(pdf.headers()["content-disposition"]).toMatch(/attachment; filename="reservations-\d{4}-\d{2}-\d{2}\.pdf"/);
  const pdfBody = await pdf.body();
  expect(pdfBody.subarray(0, 8).toString("ascii")).toBe("%PDF-1.4");
  expect(pdfBody.toString("ascii")).toContain("Reservation export");

  if (process.env.PDF_QA_OUTPUT) {
    const output = path.resolve(process.env.PDF_QA_OUTPUT);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, pdfBody);
  }

  const invalid = await context.request.get(
    "/admin/reservations/export/pdf?from=2026-01-01&to=2027-12-31",
  );
  expect(invalid.status()).toBe(400);
  await context.close();
});

test("export controls preserve active reservation filters", async ({ browser }) => {
  const context = await browser.newContext();
  await signInAs(context, "admin");
  const page = await context.newPage();
  await page.goto("/admin/reservations?status=pending&from=2026-09-01&to=2026-12-31");

  await expect(page.getByRole("link", { name: "CSV / Excel" })).toHaveAttribute(
    "href",
    /\/admin\/reservations\/export\/csv\?status=pending&from=2026-09-01&to=2026-12-31/,
  );
  await expect(page.getByRole("link", { name: "PDF" })).toHaveAttribute(
    "href",
    /\/admin\/reservations\/export\/pdf\?status=pending&from=2026-09-01&to=2026-12-31/,
  );
  await context.close();
});
