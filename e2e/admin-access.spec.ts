import { expect, test } from "@playwright/test";

import { TEST_ACCOUNTS, TEST_PASSWORD } from "./support/accounts";
import { newVisitor, signInAs } from "./support/helpers";

test("signed-out visitors are sent to sign in, then back", async ({ browser }) => {
  const context = await newVisitor(browser);
  const page = await context.newPage();
  await page.goto("/admin/reservations");
  await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin%2Freservations/);
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();

  await page.getByLabel("Email").fill(TEST_ACCOUNTS.admin.email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That email and password don't match an administrator account.")).toBeVisible();

  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin\/reservations$/);

  // Sign out from the account menu.
  await page.getByRole("button", { name: `Account menu for ${TEST_ACCOUNTS.admin.name}` }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  await context.close();
});

test("the sign-in page ignores off-site redirect targets", async ({ browser }) => {
  const context = await newVisitor(browser);
  const page = await context.newPage();
  await page.goto("/admin/login?next=//evil.example.com/");
  await page.getByLabel("Email").fill(TEST_ACCOUNTS.admin.email);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/localhost:\d+\/admin$/);
  await context.close();
});

test("password-setup links require a user action before consuming the token", async ({ browser }) => {
  const context = await newVisitor(browser);
  const page = await context.newPage();
  await page.goto("/admin/auth/confirm?token_hash=e2e-password-setup-token&type=recovery&next=%2Fadmin%2Fset-password");

  await expect(page.getByRole("heading", { name: "Continue to choose your password" })).toBeVisible();
  await expect(page).toHaveURL(/token_hash=e2e-password-setup-token/);

  await page.getByRole("button", { name: "Continue securely" }).click();
  await expect(page).toHaveURL(/\/admin\/set-password$/);
  await expect(page.getByRole("heading", { name: "Choose a password" })).toBeVisible();
  await context.close();
});

test("an invalid password-setup link shows an error instead of the dashboard", async ({ browser }) => {
  const context = await browser.newContext();
  await signInAs(context, "superAdmin");
  const page = await context.newPage();
  await page.goto("/admin/auth/confirm?token_hash=invalid&type=recovery");
  await page.getByRole("button", { name: "Continue securely" }).click();

  await expect(page).toHaveURL(/\/admin\/auth\/confirm\?error=link_expired$/);
  await expect(page.getByRole("heading", { name: "We couldn't confirm this link" })).toBeVisible();
  await context.close();
});

test("Admins can't open Super Admin pages; Super Admins can", async ({ browser }) => {
  const adminContext = await browser.newContext();
  await signInAs(adminContext, "admin");
  const admin = await adminContext.newPage();
  for (const path of ["/admin/rooms", "/admin/users", "/admin/settings", "/admin/audit"]) {
    await admin.goto(path);
    await expect(admin.getByRole("heading", { name: "Super Admin access required" })).toBeVisible();
  }
  // Their navigation doesn't offer those sections either.
  await admin.goto("/admin");
  await expect(admin.getByRole("link", { name: "Settings" })).toHaveCount(0);

  const superContext = await browser.newContext();
  await signInAs(superContext, "superAdmin");
  const sup = await superContext.newPage();
  await sup.goto("/admin/settings");
  await expect(sup.getByRole("heading", { name: "Settings" })).toBeVisible();
  await sup.goto("/admin/audit");
  await expect(sup.getByRole("heading", { name: /audit/i }).first()).toBeVisible();

  await adminContext.close();
  await superContext.close();
});

test("the email cron endpoint requires its secret", async ({ request }) => {
  expect((await request.get("/api/cron/email-outbox")).status()).toBe(401);
  expect((await request.get("/api/cron/email-outbox", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
  const ok = await request.get("/api/cron/email-outbox", { headers: { authorization: "Bearer e2e-cron-secret" } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ ok: true });
});
