import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
  await create.getByLabel("Planning opens (Central time)").fill(new Date(now - 2 * 86400000).toISOString().slice(0, 16));
  await create.getByLabel("Planning deadline (Central time)").fill(new Date(now + 30 * 86400000).toISOString().slice(0, 16));
  await create.getByRole("button", { name: "Create draft cycle" }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  const cycle = page.getByRole("article").filter({ hasText: "Browser test cycle" });
  await cycle.getByRole("button", { name: "Open cycle" }).click();
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
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await visitor.close();
  await staff.close();
});

test("ordinary Admins cannot open Church Calendar management", async ({ browser }) => {
  const context = await browser.newContext();
  await signInAs(context, "admin");
  const page = await context.newPage();
  await page.goto("/admin/church-calendar");
  await expect(page.getByText("Super Admin access required")).toBeVisible();
  await context.close();
});
