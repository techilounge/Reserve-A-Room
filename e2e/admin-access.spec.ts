import { expect, test } from "@playwright/test";

import { PENDING_INVITEE, TEST_ACCOUNTS, TEST_PASSWORD } from "./support/accounts";
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

test("an invited Admin's first portal entry is audited and notifies Super Admins exactly once", async ({ browser }) => {
  const context = await newVisitor(browser);
  const page = await context.newPage();
  await page.goto("/admin/auth/confirm?token_hash=e2e-password-setup-token&type=invite");
  await page.getByRole("button", { name: "Continue securely" }).click();
  await page.getByLabel("New password").fill(TEST_PASSWORD);
  await page.getByLabel("Confirm password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  const mockUrl = `http://127.0.0.1:${process.env.MOCK_SUPABASE_PORT ?? 54400}`;
  const queued = await fetch(`${mockUrl}/qa/system-emails?entity=${TEST_ACCOUNTS.admin.id}`);
  expect(await queued.json()).toHaveLength(1);

  await page.getByRole("button", { name: `Account menu for ${TEST_ACCOUNTS.admin.name}` }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.getByLabel("Email").fill(TEST_ACCOUNTS.admin.email);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  expect(await (await fetch(`${mockUrl}/qa/system-emails?entity=${TEST_ACCOUNTS.admin.id}`)).json()).toHaveLength(1);

  const superContext = await browser.newContext();
  await signInAs(superContext, "superAdmin");
  const audit = await superContext.newPage();
  await audit.goto("/admin/audit?entity=user");
  const acceptance = audit.getByRole("listitem").filter({ hasText: "Administrator invitation accepted" }).first();
  await expect(acceptance).toContainText(TEST_ACCOUNTS.admin.name);

  await superContext.close();
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

test("Super Admin accounts must be demoted before the Disable control is available", async ({ browser }) => {
  const context = await browser.newContext();
  await signInAs(context, "superAdmin");
  const page = await context.newPage();
  await page.goto("/admin/users");

  await expect(page.getByRole("button", { name: `Disable ${TEST_ACCOUNTS.superAdmin.name}` })).toBeDisabled();
  await expect(page.getByText("Demote to Admin before disabling this account.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Disable ${TEST_ACCOUNTS.admin.name}` })).toBeEnabled();

  await page.getByRole("button", { name: `Disable ${TEST_ACCOUNTS.admin.name}` }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: `Disable ${TEST_ACCOUNTS.admin.name}?` })).toBeVisible();
  await expect(page.getByText("They will be signed out and won't be able to sign in until a Super Admin re-enables their account.")).toBeVisible();
  await page.getByRole("button", { name: "Keep enabled" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await context.close();
});

test("Super Admins can confirm resending an unaccepted invitation", async ({ browser }) => {
  const context = await browser.newContext();
  await signInAs(context, "superAdmin");
  const page = await context.newPage();
  await page.goto("/admin/users");

  const invitee = page.getByRole("listitem").filter({ hasText: PENDING_INVITEE.email });
  await expect(invitee.getByText("Invitation pending", { exact: true })).toBeVisible();
  await invitee.getByRole("button", { name: `Resend invite to ${PENDING_INVITEE.name}` }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: `Resend invitation to ${PENDING_INVITEE.name}?` })).toBeVisible();
  await expect(
    page.getByText(
      `A new secure password setup link will be emailed to ${PENDING_INVITEE.email}. Previously issued links may stop working.`,
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep current invitation" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await invitee.getByRole("button", { name: `Resend invite to ${PENDING_INVITEE.name}` }).click();
  await page.getByRole("button", { name: "Resend invitation" }).click();
  await expect(
    page.getByText(`A new setup link was created, but the email couldn't be sent to ${PENDING_INVITEE.email}.`, {
      exact: false,
    }),
  ).toBeVisible();

  await context.close();
});

test("Audit Log search and date filters update live and reset pagination", async ({ browser }) => {
  const context = await browser.newContext();
  await signInAs(context, "superAdmin");
  const page = await context.newPage();
  await page.goto("/admin/audit?page=2");
  await page.getByLabel("Search").fill("Amenity created · Chairs");
  await expect(page).toHaveURL(/q=Amenity/);
  await expect(page).not.toHaveURL(/page=2/);
  await expect(page.getByRole("listitem").filter({ hasText: "Amenity created · Chairs" })).toBeVisible();
  await page.getByLabel("Type").selectOption("user");
  await expect(page).toHaveURL(/entity=user/);
  await page.getByLabel("Date").selectOption("custom");
  await page.getByLabel("From").fill("2026-09-01");
  await page.getByLabel("Through").fill("2026-09-30");
  await expect(page).toHaveURL(/date=custom/);
  await expect(page).toHaveURL(/from=2026-09-01/);
  await expect(page).toHaveURL(/to=2026-09-30/);
  await expect(page.getByText(/entire audit history/i)).toBeVisible();
  await context.close();
});

test("the email cron endpoint requires its secret", async ({ request }) => {
  expect((await request.get("/api/cron/email-outbox")).status()).toBe(401);
  expect((await request.get("/api/cron/email-outbox", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
  const ok = await request.get("/api/cron/email-outbox", { headers: { authorization: "Bearer e2e-cron-secret" } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({
    ok: true,
    series: { claimed: expect.any(Number), created: expect.any(Number), exceptions: expect.any(Number), failed: 0 },
  });
});
