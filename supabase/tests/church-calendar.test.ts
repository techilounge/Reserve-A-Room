import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asRole, createStaff, createTestDb } from "./support/db";

let db: PGlite;
let owner: string;
let admin: string;
let cycle: string;
let plan: string;
let otherPlan: string;
let reference: string;
let otherReference: string;
let deliveryA: string;
const grantA = crypto.randomUUID();
const grantB = crypto.randomUUID();
const grantC = crypto.randomUUID();
const hashA = "11".repeat(32);
const hashB = "22".repeat(32);
const sessionA = "aa".repeat(32);
const sessionB = "bb".repeat(32);

beforeAll(async () => {
  db = await createTestDb();
  owner = await createStaff(db, "super_admin");
  admin = await createStaff(db, "admin");
  const created = await asRole(db, "authenticated", (tx) => tx.query<{ id: string }>(
    "select public.save_calendar_cycle(null, 'Annual', current_date, current_date + 365, now() - interval '1 day', now() + interval '30 days', '') as id",
  ), owner);
  cycle = created.rows[0].id;
  const ministries = await db.query<{ id: string }>("select id from public.ministries where active order by name limit 2");
  const p1 = await asRole(db, "authenticated", (tx) => tx.query<{ id: string }>(
    "select public.add_calendar_ministry($1, $2) as id", [cycle, ministries.rows[0].id],
  ), owner);
  const p2 = await asRole(db, "authenticated", (tx) => tx.query<{ id: string }>(
    "select public.add_calendar_ministry($1, $2) as id", [cycle, ministries.rows[1].id],
  ), owner);
  plan = p1.rows[0].id;
  otherPlan = p2.rows[0].id;
  const refs = await db.query<{ id: string; reference_code: string }>("select id, reference_code from public.ministry_calendar_plans where id in ($1, $2)", [plan, otherPlan]);
  reference = refs.rows.find((row) => row.id === plan)!.reference_code;
  otherReference = refs.rows.find((row) => row.id === otherPlan)!.reference_code;
  await asRole(db, "authenticated", (tx) => tx.query("select public.transition_calendar_cycle($1, 'open', null)", [cycle]), owner);
});

afterAll(async () => { await db.close(); });

async function invite(id: string, email: string, hash: string) {
  return asRole(db, "authenticated", (tx) => tx.query<{ id: string }>(
    "select public.invite_calendar_planner($1, $2, 'Planner', $3, null, 'additional', $4, $5) as id",
    [plan, id, email, hash, "33".repeat(16)],
  ), owner);
}

async function exchange(p: string, grant: string, token: string, session: string) {
  const ref = p === plan ? reference : p === otherPlan ? otherReference : p;
  return asRole(db, "service_role", async (tx) => (await tx.query<{ ok: boolean }>(
    "select public.exchange_calendar_planner_session($1, $2, $3, $4) as ok", [ref, grant, token, session],
  )).rows[0].ok);
}

async function context(p: string, session: string) {
  const ref = p === plan ? reference : p === otherPlan ? otherReference : p;
  return asRole(db, "service_role", async (tx) => (await tx.query<{ value: unknown }>(
    "select public.calendar_planner_session_context($1, $2) as value", [ref, session],
  )).rows[0].value);
}

describe("Church Calendar Phase 1 authorization", () => {
  it("restricts privileged calls and private token/session tables", async () => {
    await expect(asRole(db, "authenticated", (tx) => tx.query(
      "select public.transition_calendar_cycle($1, 'review', null)", [cycle],
    ), admin)).rejects.toMatchObject({ code: "RAR09" });
    for (const role of ["anon", "authenticated"] as const) {
      await expect(asRole(db, role, (tx) => tx.query("select token_hash from public.calendar_plan_access"), owner))
        .rejects.toMatchObject({ code: "42501" });
      await expect(asRole(db, role, (tx) => tx.query("select session_hash from public.calendar_plan_sessions"), owner))
        .rejects.toMatchObject({ code: "42501" });
      await expect(asRole(db, role, (tx) => tx.query(
        "select public.exchange_calendar_planner_session($1, $2, $3, $4)", [plan, grantA, hashA, sessionA],
      ), owner)).rejects.toMatchObject({ code: "42501" });
    }
    await expect(asRole(db, "service_role", (tx) => tx.query("select token_seed from public.calendar_plan_access")))
      .rejects.toMatchObject({ code: "42501" });
    await expect(asRole(db, "service_role", (tx) => tx.query("select public.transition_calendar_cycle($1, 'review', null)", [cycle])))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("allows independent grants and prevents cross-plan session use", async () => {
    deliveryA = (await invite(grantA, "alice@example.org", hashA)).rows[0].id;
    await invite(grantB, "bob@example.org", hashB);
    const queued = await db.query<{ id: string; payload: unknown }>(
      "select id, payload from public.system_email_logs where entity_type = 'calendar_invitation' and entity_id = $1", [deliveryA],
    );
    expect(queued.rows).toHaveLength(1);
    expect(queued.rows[0].payload).toEqual({});
    const mail = await asRole(db, "service_role", (tx) => tx.query<{ value: { grant_id: string } }>(
      "select public.calendar_invitation_context($1) as value", [queued.rows[0].id],
    ));
    expect(mail.rows[0].value.grant_id).toBe(grantA);
    const internalId = await asRole(db, "service_role", (tx) => tx.query<{ ok: boolean }>(
      "select public.exchange_calendar_planner_session($1, $2, $3, $4) as ok", [plan, grantA, hashA, "c1".repeat(32)],
    ));
    expect(internalId.rows[0].ok).toBe(false);
    expect(await exchange(otherPlan, grantA, hashA, sessionA)).toBe(false);
    expect(await exchange(plan, grantA, hashA, sessionA)).toBe(true);
    expect(await exchange(plan, grantB, hashB, sessionB)).toBe(true);
    expect(await context(plan, sessionA)).toMatchObject({ grant_id: grantA });
    expect(await context(otherPlan, sessionA)).toBeNull();
    const events = await db.query<{ metadata: unknown }>("select metadata from public.audit_logs where action = 'calendar_access.opened' and entity_id = $1", [grantA]);
    expect(events.rows).toHaveLength(1);
    expect(JSON.stringify(events.rows[0])).not.toContain(hashA);
    expect(JSON.stringify(events.rows[0])).not.toContain(sessionA);
  });

  it("rotates only one grant and invalidates its old link and session", async () => {
    const newHash = "44".repeat(32);
    await asRole(db, "authenticated", (tx) => tx.query(
      "select public.rotate_calendar_invitation($1, 1, $2, $3)", [grantA, newHash, "55".repeat(16)],
    ), owner);
    expect(await context(plan, sessionA)).toBeNull();
    const oldMail = await asRole(db, "service_role", (tx) => tx.query<{ value: unknown }>(
      "select public.calendar_invitation_context(id) as value from public.system_email_logs where entity_id = $1", [deliveryA],
    ));
    expect(oldMail.rows[0].value).toBeNull();
    expect(await exchange(plan, grantA, hashA, "cc".repeat(32))).toBe(false);
    expect(await context(plan, sessionB)).toMatchObject({ grant_id: grantB });
    expect(await exchange(plan, grantA, newHash, "dd".repeat(32))).toBe(true);
  });

  it("enforces the five-active limit and excludes revoked grants", async () => {
    for (let n = 0; n < 3; n++) await invite(crypto.randomUUID(), `extra${n}@example.org`, (60 + n).toString(16).repeat(32));
    await expect(invite(crypto.randomUUID(), "sixth@example.org", "77".repeat(32))).rejects.toMatchObject({ code: "RAR09" });
    await asRole(db, "authenticated", (tx) => tx.query("select public.revoke_calendar_planner($1)", [grantA]), owner);
    await invite(grantC, "sixth@example.org", "77".repeat(32));
    expect(await exchange(plan, grantC, "77".repeat(32), "ee".repeat(32))).toBe(true);
    expect(await context(plan, sessionB)).toMatchObject({ grant_id: grantB });
  });

  it("does not count expired grants and permits re-inviting their email", async () => {
    await db.query("update public.calendar_plan_access set expires_at = now() - interval '1 second' where id = $1", [grantB]);
    expect(await context(plan, sessionB)).toBeNull();
    await asRole(db, "authenticated", (tx) => tx.query(
      `select public.save_calendar_cycle(id, name, start_date, end_date, submission_opens_at,
        submission_deadline + interval '1 day', instructions) from public.calendar_cycles where id = $1`, [cycle],
    ), owner);
    const state = await db.query<{ expired: boolean; active_deadline: boolean }>(
      `select (select expires_at <= now() from public.calendar_plan_access where id = $1) as expired,
       (select a.expires_at = c.submission_deadline from public.calendar_plan_access a join public.ministry_calendar_plans p on p.id = a.plan_id
        join public.calendar_cycles c on c.id = p.cycle_id where a.id = $2) as active_deadline`, [grantB, grantC],
    );
    expect(state.rows[0]).toEqual({ expired: true, active_deadline: true });
    await invite(crypto.randomUUID(), "BOB@example.org", "88".repeat(32));
    const old = await db.query<{ revoked: boolean }>("select revoked_at is not null as revoked from public.calendar_plan_access where id = $1", [grantB]);
    expect(old.rows[0].revoked).toBe(true);
  });

  it("admits only one of two competing invitations for the final active slot", async () => {
    await asRole(db, "authenticated", (tx) => tx.query("select public.revoke_calendar_planner($1)", [grantC]), owner);
    const attempts = await Promise.allSettled([
      invite(crypto.randomUUID(), "race-one@example.org", "a1".repeat(32)),
      invite(crypto.randomUUID(), "race-two@example.org", "a2".repeat(32)),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const count = await db.query<{ count: number }>("select count(*)::int as count from public.calendar_plan_access where plan_id = $1 and revoked_at is null and expires_at > now()", [plan]);
    expect(count.rows[0].count).toBe(5);
  });

  it("enforces the cycle length and exposes only active resource fields to staff", async () => {
    await expect(asRole(db, "authenticated", (tx) => tx.query(
      "select public.save_calendar_cycle(null, 'Too long', '2027-01-01', '2030-01-02', now(), now() + interval '2 days', '')",
    ), owner)).rejects.toMatchObject({ code: "23514" });
    await asRole(db, "authenticated", (tx) => tx.query(
      "select public.save_calendar_resource(null, 'Projector', 'equipment', 2, true, '', 'private')",
    ), owner);
    const items = await asRole(db, "authenticated", (tx) => tx.query<{ name: string; private_notes?: string }>(
      "select * from public.calendar_active_resources()",
    ), admin);
    expect(items.rows).toEqual([{ id: expect.any(String), name: "Projector", category: "equipment", description: null, available_quantity: 2 }]);
    const active = await db.query<{ id: string; hash: string }>(
      "select id, encode(token_hash, 'hex') as hash from public.calendar_plan_access where plan_id = $1 and revoked_at is null and expires_at > now() limit 1", [plan],
    );
    expect(await exchange(plan, active.rows[0].id, active.rows[0].hash, "ab".repeat(32))).toBe(true);
    const ownResources = await asRole(db, "service_role", (tx) => tx.query("select * from public.calendar_planner_resources($1, $2)", [reference, "ab".repeat(32)]));
    const otherResources = await asRole(db, "service_role", (tx) => tx.query("select * from public.calendar_planner_resources($1, $2)", [otherReference, "ab".repeat(32)]));
    expect(ownResources.rows).toHaveLength(1);
    expect(otherResources.rows).toHaveLength(0);
  });

  it("requires an audited reason to reopen and closes sessions during review", async () => {
    // Establish a fresh session for an unrevoked planner before the transition.
    const active = await db.query<{ id: string; hash: string }>(
      "select id, encode(token_hash, 'hex') as hash from public.calendar_plan_access where plan_id = $1 and revoked_at is null and expires_at > now() limit 1", [plan],
    );
    expect(await exchange(plan, active.rows[0].id, active.rows[0].hash, "ef".repeat(32))).toBe(true);
    await asRole(db, "authenticated", (tx) => tx.query("select public.transition_calendar_cycle($1, 'review', null)", [cycle]), owner);
    expect(await context(plan, "ef".repeat(32))).toBeNull();
    await expect(invite(crypto.randomUUID(), "closed@example.org", "99".repeat(32))).rejects.toMatchObject({ code: "RAR09" });
    await expect(asRole(db, "authenticated", (tx) => tx.query(
      "select public.transition_calendar_cycle($1, 'open', '')", [cycle],
    ), owner)).rejects.toMatchObject({ code: "RAR09" });
    await asRole(db, "authenticated", (tx) => tx.query(
      "select public.transition_calendar_cycle($1, 'open', 'Correction requested')", [cycle],
    ), owner);
    const audit = await db.query<{ metadata: { reason?: string } }>(
      "select metadata from public.audit_logs where entity_id = $1 and action = 'calendar_cycle.transitioned' order by id desc limit 1", [cycle],
    );
    expect(audit.rows[0].metadata.reason).toBe("Correction requested");
  });
});
