import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { TEST_ACCOUNTS } from "./support/accounts";
import { signInAs } from "./support/helpers";

test("a Super Admin configures a cycle and independently rotates one planner's access", async ({ browser }) => {
  const staff = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await signInAs(staff, "superAdmin");
  const page = await staff.newPage();
  await page.goto("/admin/church-calendar");
  const create = page.getByRole("region", { name: "Create a planning cycle" });
  const now = Date.now();
  await create.getByLabel("Cycle name").fill("Browser test cycle");
  await create.getByLabel("Calendar start").fill(new Date(now).toISOString().slice(0, 10));
  await create.getByLabel("Calendar end").fill(new Date(now + 180 * 86400000).toISOString().slice(0, 10));
  await create.getByLabel("Planning opens (America/Chicago)").fill(new Date(now - 2 * 86400000).toISOString().slice(0, 16));
  await create.getByLabel("Planning deadline (America/Chicago)").fill(new Date(now + 30 * 86400000).toISOString().slice(0, 16));
  await create.getByRole("button", { name: "Create draft cycle" }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  const cycle = page.getByRole("article").filter({ hasText: "Browser test cycle" });
  await cycle.getByRole("button", { name: "Open cycle" }).click();
  const ministryName = await cycle.getByLabel("Participating ministry").locator("option").nth(1).textContent();
  if (!ministryName) throw new Error("Expected a ministry fixture");
  await cycle.getByLabel("Participating ministry").selectOption({ index: 1 });
  await cycle.getByRole("button", { name: "Add ministry" }).click();
  await cycle.getByText("Invite a planner").click();
  const invitation = cycle.locator("details").filter({ hasText: "Invite a planner" });
  await invitation.getByLabel("Name", { exact: true }).fill("Alice Example");
  await invitation.getByLabel("Email").fill("calendar-alice@example.org");
  await invitation.getByRole("button", { name: "Queue invitation" }).click();
  await expect(cycle.getByText("Alice Example")).toBeVisible();
  const mockUrl = `http://127.0.0.1:${process.env.MOCK_SUPABASE_PORT ?? 54400}`;
  const details = await (await fetch(`${mockUrl}/qa/calendar-invitation?email=calendar-alice%40example.org`)).json() as { plan: string; grant: string; token: string };
  const visitor = await browser.newContext();
  const planner = await visitor.newPage();
  const invitationUrl = `/calendar-plan/${details.plan}?grant=${details.grant}&token=${details.token}`;
  const response = await planner.goto(invitationUrl);
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(planner.getByRole("heading", { name: "Open your planning invitation" })).toBeVisible();
  await planner.reload(); // GET alone must not consume the invitation.
  await planner.getByRole("button", { name: "Continue" }).click();
  await expect(planner).toHaveURL(new RegExp(`/calendar-plan/${details.plan}$`));
  const sessionCookie = (await visitor.cookies()).find((cookie) => cookie.name === "calendar_planner");
  expect(sessionCookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: `/calendar-plan/${details.plan}` });
  await expect(planner.getByText(/Welcome, Alice Example/)).toBeVisible();
  await expect(planner.locator("body")).not.toContainText(details.token);
  const row = cycle.locator("div").filter({ hasText: "Alice Example" }).filter({ has: page.getByRole("button", { name: "Replace and resend" }) }).last();
  await row.getByRole("button", { name: "Replace and resend" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Replace and resend" }).click();
  await expect(page.getByRole("status")).toContainText("replacement invitation was queued");
  await planner.reload();
  await expect(planner.getByRole("heading", { name: "Planning access unavailable" })).toBeVisible();
  await planner.goto(invitationUrl);
  await planner.getByRole("button", { name: "Continue" }).click();
  await expect(planner.getByRole("heading", { name: "Planning access unavailable" })).toBeVisible();
  const replacement = await (await fetch(`${mockUrl}/qa/calendar-invitation?email=calendar-alice%40example.org`)).json() as { plan: string; grant: string; token: string };
  const replacementUrl = `/calendar-plan/${replacement.plan}?grant=${replacement.grant}&token=${replacement.token}`;
  await planner.goto(replacementUrl);
  await planner.getByRole("button", { name: "Continue" }).click();
  await expect(planner.getByText(/Welcome, Alice Example/)).toBeVisible();
  await cycle.getByRole("button", { name: "Remove ministry from cycle" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove ministry from cycle" }).click();
  await expect(page.getByRole("status")).toContainText("Ministry removed");
  await planner.reload();
  await expect(planner.getByRole("heading", { name: "Planning access unavailable" })).toBeVisible();
  await cycle.getByLabel("Participating ministry").selectOption({ label: ministryName });
  await cycle.getByRole("button", { name: "Add ministry" }).click();
  await expect(cycle.getByText("Alice Example")).toBeVisible();
  await expect(cycle.getByText(/calendar-alice@example.org · Revoked/)).toBeVisible();
  await planner.goto(replacementUrl);
  await planner.getByRole("button", { name: "Continue" }).click();
  await expect(planner.getByRole("heading", { name: "Planning access unavailable" })).toBeVisible();
  const audit = await staff.newPage();
  await audit.goto("/admin/audit?entity=calendar_plan");
  const removal = audit.getByRole("listitem").filter({ hasText: "Ministry removed from church calendar" }).first();
  await expect(removal).toContainText(ministryName);
  await expect(removal).toContainText(`By ${TEST_ACCOUNTS.superAdmin.name}`);
  await audit.close();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await visitor.close();
  await staff.close();
});

test("cycle times use the configured timezone for saving and display", async ({ browser }) => {
  const mockUrl = `http://127.0.0.1:${process.env.MOCK_SUPABASE_PORT ?? 54400}`;
  const changeTimezone = (timezone: string) => fetch(`${mockUrl}/qa/timezone`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ timezone }),
  });
  const context = await browser.newContext();
  try {
    expect((await changeTimezone("America/New_York")).ok).toBe(true);
    await signInAs(context, "superAdmin");
    const page = await context.newPage();
    await page.goto("/admin/church-calendar");
    const create = page.getByRole("region", { name: "Create a planning cycle" });
    await expect(create.getByText(/configured church timezone: America\/New_York/)).toBeVisible();
    await create.getByLabel("Cycle name").fill("Timezone review cycle");
    await create.getByLabel("Calendar start").fill("2027-01-01");
    await create.getByLabel("Calendar end").fill("2027-12-31");
    await create.getByLabel("Planning opens (America/New_York)").fill("2027-01-15T08:30");
    await create.getByLabel("Planning deadline (America/New_York)").fill("2027-02-15T17:00");
    await create.getByRole("button", { name: "Create draft cycle" }).click();
    await expect(page.getByRole("status")).toContainText("saved");
    const saved = await (await fetch(`${mockUrl}/qa/calendar-cycle?name=Timezone%20review%20cycle`)).json() as { submission_opens_at: string; submission_deadline: string };
    expect(new Date(saved.submission_opens_at).toISOString()).toBe("2027-01-15T13:30:00.000Z");
    expect(new Date(saved.submission_deadline).toISOString()).toBe("2027-02-15T22:00:00.000Z");
    const cycle = page.getByRole("article").filter({ hasText: "Timezone review cycle" });
    await expect(cycle).toContainText("Jan 15, 2027, 8:30 AM");
    await expect(cycle).toContainText("Feb 15, 2027, 5:00 PM");
    await cycle.getByText("Edit cycle").click();
    await expect(cycle.getByLabel("Planning opens (America/New_York)")).toHaveValue("2027-01-15T08:30");
    expect((await changeTimezone("America/Chicago")).ok).toBe(true);
    await cycle.getByRole("button", { name: "Save cycle" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "timezone changed" })).toBeVisible();
  } finally {
    await changeTimezone("America/Chicago");
    await context.close();
  }
});

test("ordinary Admins cannot open Church Calendar management", async ({ browser }) => {
  const context = await browser.newContext();
  await signInAs(context, "admin");
  const page = await context.newPage();
  await page.goto("/admin/church-calendar");
  await expect(page.getByText("Super Admin access required")).toBeVisible();
  await context.close();
});
