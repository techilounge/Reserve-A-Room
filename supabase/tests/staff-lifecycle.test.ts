import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { asRole, createStaff, createTestDb } from "./support/db";

let db: PGlite;
let superAdmin: string;
let invitedAdmin: string;
let resetOnlyAdmin: string;
let bootstrapAdmin: string;

beforeAll(async () => {
  db = await createTestDb();
  superAdmin = await createStaff(db, "super_admin", { email: "lifecycle-super@example.org" });
  await createStaff(db, "super_admin", { active: false, email: "inactive-super@example.org" });
  invitedAdmin = await createStaff(db, "admin", { email: "accepted-admin@example.org" });
  resetOnlyAdmin = await createStaff(db, "admin", { email: "reset-only@example.org" });
  bootstrapAdmin = await createStaff(db, "admin", { email: "bootstrap-style@example.org" });
  await db.query("update public.profiles set invited_by = $1 where id in ($2, $3)", [
    superAdmin,
    invitedAdmin,
    resetOnlyAdmin,
  ]);
});

const asUser = <T>(userId: string, sql: string) =>
  asRole(db, "authenticated", async (tx) => (await tx.query<T>(sql)).rows, userId);

describe("staff invitation acceptance", () => {
  it("records acceptance/login and queues exactly one email per active Super Admin", async () => {
    expect(await asUser<{ accepted: boolean }>(invitedAdmin, "select public.complete_staff_password_setup() as accepted")).toEqual([
      { accepted: true },
    ]);

    const profile = await db.query<{ invitation_accepted_at: string; first_login_at: string }>(
      "select invitation_accepted_at::text, first_login_at::text from public.profiles where id = $1",
      [invitedAdmin],
    );
    expect(profile.rows[0].invitation_accepted_at).toBeTruthy();
    expect(profile.rows[0].first_login_at).toBeTruthy();

    const emails = await db.query<{ recipient: string; event_type: string }>(
      "select recipient, event_type from public.system_email_logs where entity_id = $1 order by recipient",
      [invitedAdmin],
    );
    expect(emails.rows).toEqual([{ recipient: "lifecycle-super@example.org", event_type: "admin_first_login" }]);
    expect(emails.rows.some((row) => row.recipient === "inactive-super@example.org")).toBe(false);

    const audit = await db.query<{ action: string; actor_user_id: string }>(
      "select action, actor_user_id from public.audit_logs where entity_id = $1 and action in ('user.invitation_accepted', 'user.logged_in') order by id",
      [invitedAdmin],
    );
    expect(audit.rows).toEqual([
      { action: "user.invitation_accepted", actor_user_id: invitedAdmin },
      { action: "user.logged_in", actor_user_id: invitedAdmin },
    ]);
  });

  it("is idempotent and exposes lifecycle email context only to the service worker", async () => {
    expect(await asUser<{ accepted: boolean }>(invitedAdmin, "select public.complete_staff_password_setup() as accepted")).toEqual([
      { accepted: false },
    ]);
    expect((await db.query("select id from public.system_email_logs where entity_id = $1", [invitedAdmin])).rows).toHaveLength(1);

    const [{ id }] = await asRole(db, "service_role", async (tx) =>
      (await tx.query<{ id: string }>("select public.claim_system_emails(10, $1) as id", [invitedAdmin])).rows,
    );
    const [context] = await asRole(db, "service_role", async (tx) =>
      (
        await tx.query<{ context: { event_type: string; user: { email: string; role: string } } }>(
          "select public.system_email_context($1) as context",
          [id],
        )
      ).rows,
    );
    expect(context.context).toMatchObject({
      event_type: "admin_first_login",
      user: { email: "accepted-admin@example.org", role: "admin" },
    });
  });
});

describe("ordinary staff login", () => {
  it("records every successful password login without accepting a pending invite", async () => {
    await asUser(resetOnlyAdmin, "select public.record_staff_login('password')");
    await asUser(resetOnlyAdmin, "select public.record_staff_login('password')");
    const profile = await db.query<{ first_login_at: string; invitation_accepted_at: string | null }>(
      "select first_login_at::text, invitation_accepted_at::text from public.profiles where id = $1",
      [resetOnlyAdmin],
    );
    expect(profile.rows[0].first_login_at).toBeTruthy();
    expect(profile.rows[0].invitation_accepted_at).toBeNull();
    expect((await db.query("select id from public.system_email_logs where entity_id = $1", [resetOnlyAdmin])).rows).toHaveLength(0);
    expect(
      (await db.query("select id from public.audit_logs where entity_id = $1 and action = 'user.logged_in'", [resetOnlyAdmin])).rows,
    ).toHaveLength(2);
  });

  it("does not turn a bootstrap-style profile into an accepted invitation", async () => {
    expect(await asUser<{ accepted: boolean }>(bootstrapAdmin, "select public.complete_staff_password_setup() as accepted")).toEqual([
      { accepted: false },
    ]);
    expect((await db.query("select id from public.system_email_logs where entity_id = $1", [bootstrapAdmin])).rows).toHaveLength(0);
  });
});
