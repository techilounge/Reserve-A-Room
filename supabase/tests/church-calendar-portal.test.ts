import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asRole, createRoom, createStaff, createTestDb } from "./support/db";

let db: PGlite;
let reference: string;
let planId: string;
let ownerId: string;
let eventId: string;
const grants = [crypto.randomUUID(), crypto.randomUUID()];
const tokens = ["11".repeat(32), "22".repeat(32)];
const sessions = ["aa".repeat(32), "bb".repeat(32)];

beforeAll(async () => {
  db = await createTestDb();
  const owner = await createStaff(db, "super_admin");
  ownerId = owner;
  const { rows: [ministry] } = await db.query<{ id: string }>("select id from public.ministries where active limit 1");
  const { rows: [created] } = await asRole(db, "authenticated", tx => tx.query<{ id: string }>(
    "select public.save_calendar_cycle(null, 'Planning', current_date, current_date + 365, now() - interval '1 day', now() + interval '30 days', '') as id",
  ), owner);
  const { rows: [createdPlan] } = await asRole(db, "authenticated", tx => tx.query<{ id: string }>(
    "select public.add_calendar_ministry($1, $2) as id", [created.id, ministry.id],
  ), owner);
  const { rows: [plan] } = await db.query<{ reference_code: string }>("select reference_code from public.ministry_calendar_plans where id = $1", [createdPlan.id]);
  reference = plan.reference_code;
  planId = createdPlan.id;
  await asRole(db, "authenticated", tx => tx.query("select public.transition_calendar_cycle($1, 'open', null)", [created.id]), owner);
  for (let i = 0; i < 2; i++) {
    await asRole(db, "authenticated", tx => tx.query(
      "select public.invite_calendar_planner($1, $2, 'Planner', $3, null, 'additional', $4, $5)",
      [createdPlan.id, grants[i], `planner${i}@example.org`, tokens[i], "33".repeat(16)],
    ), owner);
    await asRole(db, "service_role", tx => tx.query(
      "select public.exchange_calendar_planner_session($1, $2, $3, $4)", [reference, grants[i], tokens[i], sessions[i]],
    ));
  }
});
afterAll(async () => { await db.close(); });

describe("planner portal security foundations", () => {
  it("defaults to disabled and cannot be enabled without approved version identifiers", async () => {
    const result = await asRole(db, "service_role", tx => tx.query<{ value: { enabled: boolean; accepted: boolean } }>(
      "select public.calendar_planner_policy_status($1, $2) as value", [reference, sessions[0]],
    ));
    expect(result.rows[0].value).toMatchObject({ enabled: false, accepted: false });
    await expect(db.query("update private.calendar_planner_policies set enabled = true"))
      .rejects.toMatchObject({ code: "23514" });
    await expect(asRole(db, "service_role", tx => tx.query(
      "select public.calendar_accept_planner_policies($1, $2, 'p1', 't1')", [reference, sessions[0]],
    ))).rejects.toMatchObject({ code: "RAR09" });
  });

  it("records acceptance per planner and rejects stale versions and cross-plan access", async () => {
    await db.query("update private.calendar_planner_policies set enabled = true, privacy_version = 'p1', terms_version = 't1'");
    await expect(asRole(db, "service_role", tx => tx.query(
      "select public.calendar_accept_planner_policies($1, $2, 'old', 't1')", [reference, sessions[0]],
    ))).rejects.toMatchObject({ code: "RAR09" });
    await expect(asRole(db, "service_role", tx => tx.query(
      "select public.calendar_accept_planner_policies($1, $2, 'p1', 't1')", [crypto.randomUUID(), sessions[0]],
    ))).rejects.toMatchObject({ code: "RAR09" });
    await asRole(db, "service_role", tx => tx.query(
      "select public.calendar_accept_planner_policies($1, $2, 'p1', 't1')", [reference, sessions[0]],
    ));
    const result = await asRole(db, "service_role", tx => tx.query<{ value: { accepted: boolean } }>(
      "select public.calendar_planner_policy_status($1, $2) as value", [reference, sessions[1]],
    ));
    expect(result.rows[0].value.accepted).toBe(false);
    await db.query("update private.calendar_planner_policies set terms_version = 't2'");
    const changed = await asRole(db, "service_role", tx => tx.query<{ value: { accepted: boolean } }>(
      "select public.calendar_planner_policy_status($1, $2) as value", [reference, sessions[0]],
    ));
    expect(changed.rows[0].value.accepted).toBe(false);
  });

  it("keeps event drafts scoped to the planner and never creates a reservation", async () => {
    await asRole(db, "service_role", tx => tx.query(
      "select public.calendar_accept_planner_policies($1, $2, 'p1', 't2')", [reference, sessions[0]],
    ));
    const { rows: [settings] } = await db.query<{ timezone: string; start: string }>(
      "select timezone, current_date::text as start from public.app_settings where id",
    );
    const { rows: [room] } = await db.query<{ id: string }>("select id from public.rooms where active limit 1");
    const anotherRoom = await createRoom(db);
    const { rows: [resource] } = await db.query<{ id: string }>("insert into public.calendar_resources(name, category, available_quantity) values ('Projector', 'equipment', 2) returning id");
    const { rows: [cosponsor] } = await db.query<{ id: string }>("select id from public.ministries where active and id <> (select ministry_id from public.ministry_calendar_plans where id = $1) limit 1", [planId]);
    const event = { title: "Planning meeting", scope: "ministry", visibility: "internal", location_type: "church",
      estimated_attendance: 10, schedule: { kind: "one_time", timezone: settings.timezone, start_date: settings.start,
        end_date: settings.start, start_time: "14:00", end_time: "15:00" }, rooms: [room.id, anotherRoom],
      ministries: [cosponsor.id], resources: [{ id: resource.id, quantity: 2, notes: "Slides" }] };
    const before = await db.query<{ count: number }>("select count(*)::int as count from public.reservations");
    const result = await asRole(db, "service_role", tx => tx.query<{ id: string }>(
      "select public.calendar_save_event_draft($1, $2, null, $3::jsonb) as id", [reference, sessions[0], JSON.stringify(event)],
    ));
    eventId = result.rows[0].id;
    const saved = await db.query<{ count: number }>("select count(*)::int as count from public.calendar_event_room_templates where event_id = $1", [result.rows[0].id]);
    expect(saved.rows[0].count).toBe(2);
    expect((await db.query<{ count: number }>("select count(*)::int as count from public.reservations")).rows[0]).toEqual(before.rows[0]);
    const duplicate = await asRole(db, "service_role", tx => tx.query<{ id: string }>(
      "select public.calendar_duplicate_event_draft($1, $2, $3) as id", [reference, sessions[0], eventId],
    ));
    expect(duplicate.rows[0].id).not.toBe(eventId);
    expect((await db.query<{ count: number }>("select count(*)::int as count from public.calendar_event_room_templates where event_id = $1", [duplicate.rows[0].id])).rows[0].count).toBe(2);
    await asRole(db, "service_role", tx => tx.query("select public.calendar_remove_event_draft($1, $2, $3)", [reference, sessions[0], duplicate.rows[0].id]));
    await expect(asRole(db, "service_role", tx => tx.query(
      "select public.calendar_save_event_draft($1, $2, $3, $4::jsonb)", [reference, sessions[1], result.rows[0].id, JSON.stringify(event)],
    ))).rejects.toMatchObject({ code: "RAR09" });
    await expect(asRole(db, "service_role", tx => tx.query(
      "select public.calendar_save_event_draft($1, $2, $3, $4::jsonb)", [reference, sessions[0], crypto.randomUUID(), JSON.stringify(event)],
    ))).rejects.toMatchObject({ code: "RAR09" });
  });

  it("saves incomplete schedules but blocks plan submission until they are complete", async () => {
    const { rows: [settings] } = await db.query<{ timezone: string }>("select timezone from public.app_settings where id");
    const draft = { title: "Incomplete event", scope: "ministry", visibility: "internal", location_type: "church", estimated_attendance: 1,
      schedule: { kind: "one_time", timezone: settings.timezone, start_date: "", end_date: "", start_time: "", end_time: "" } };
    const result = await asRole(db, "service_role", tx => tx.query<{ id: string }>(
      "select public.calendar_save_event_draft($1, $2, null, $3::jsonb) as id", [reference, sessions[0], JSON.stringify(draft)],
    ));
    await expect(asRole(db, "service_role", tx => tx.query("select public.calendar_submit_plan($1, $2, '', false)", [reference, sessions[0]])))
      .rejects.toMatchObject({ code: "RAR09" });
    await asRole(db, "service_role", tx => tx.query("select public.calendar_remove_event_draft($1, $2, $3)", [reference, sessions[0], result.rows[0].id]));
  });

  it("keeps unavailable selections visible and requires correction before submission", async () => {
    const { rows: [room] } = await db.query<{ room_id: string }>("select room_id from public.calendar_event_room_templates where event_id = $1", [eventId]);
    await db.query("update public.rooms set active = false where id = $1", [room.room_id]);
    try {
      const result = await asRole(db, "service_role", tx => tx.query<{ value: { rooms: { id: string; active: boolean }[] } }>(
        "select public.calendar_planner_portal($1, $2) as value", [reference, sessions[0]],
      ));
      expect(result.rows[0].value.rooms.find(item => item.id === room.room_id)?.active).toBe(false);
      await expect(asRole(db, "service_role", tx => tx.query("select public.calendar_submit_plan($1, $2, '', false)", [reference, sessions[0]])))
        .rejects.toMatchObject({ code: "RAR09" });
    } finally {
      await db.query("update public.rooms set active = true where id = $1", [room.room_id]);
    }
  });

  it("snapshots submitted requests immutably and allows an audited revision", async () => {
    const first = await asRole(db, "service_role", tx => tx.query<{ revision: number }>(
      "select public.calendar_submit_plan($1, $2, 'Ready', false) as revision", [reference, sessions[0]],
    ));
    expect(first.rows[0].revision).toBe(1);
    const snapshots = await db.query<{ id: string; title: string }>("select id, title from public.calendar_event_submissions where event_id = $1", [eventId]);
    expect(snapshots.rows[0].title).toBe("Planning meeting");
    expect((await db.query<{ count: number }>("select count(*)::int as count from public.calendar_submission_room_templates where submission_id = $1", [snapshots.rows[0].id])).rows[0].count).toBe(2);
    expect((await db.query<{ quantity_requested: number; notes: string }>("select quantity_requested, notes from public.calendar_submission_resource_templates where submission_id = $1", [snapshots.rows[0].id])).rows[0]).toEqual({ quantity_requested: 2, notes: "Slides" });
    expect((await db.query<{ count: number }>("select count(*)::int as count from public.calendar_submission_ministries where submission_id = $1", [snapshots.rows[0].id])).rows[0].count).toBe(1);
    await expect(db.query("update public.calendar_event_submissions set title = 'Changed' where id = $1", [snapshots.rows[0].id]))
      .rejects.toMatchObject({ code: "RAR09" });
    await expect(db.query("delete from public.calendar_submission_room_templates where submission_id = $1", [snapshots.rows[0].id]))
      .rejects.toMatchObject({ code: "RAR09" });
    await asRole(db, "authenticated", tx => tx.query("select public.calendar_request_plan_changes($1, 'Please revise')", [planId]), ownerId);
    const portal = await asRole(db, "service_role", tx => tx.query<{ value: { events: Record<string, unknown>[] } }>(
      "select public.calendar_planner_portal($1, $2) as value", [reference, sessions[0]],
    ));
    const revised = { ...portal.rows[0].value.events[0], title: "Revised meeting" };
    await asRole(db, "service_role", tx => tx.query(
      "select public.calendar_save_event_draft($1, $2, $3, $4::jsonb)", [reference, sessions[0], eventId, JSON.stringify(revised)],
    ));
    await expect(asRole(db, "service_role", tx => tx.query(
      "select public.calendar_save_event_draft($1, $2, $3, $4::jsonb)", [reference, sessions[0], eventId, JSON.stringify(revised)],
    ))).rejects.toMatchObject({ code: "RAR09" });
    const second = await asRole(db, "service_role", tx => tx.query<{ revision: number }>(
      "select public.calendar_submit_plan($1, $2, 'Updated', false) as revision", [reference, sessions[0]],
    ));
    expect(second.rows[0].revision).toBe(2);
    expect((await db.query<{ title: string }>("select title from public.calendar_event_submissions where id = $1", [snapshots.rows[0].id])).rows[0].title).toBe("Planning meeting");
    expect((await db.query<{ count: number }>("select count(*)::int as count from public.calendar_event_submissions where event_id = $1", [eventId])).rows[0].count).toBe(2);
  });

  it("signs out only the matching session and denies direct table access", async () => {
    for (const role of ["anon", "authenticated", "service_role"] as const) {
      await expect(asRole(db, role, tx => tx.query("select * from public.calendar_events")))
        .rejects.toMatchObject({ code: "42501" });
    }
    await asRole(db, "service_role", tx => tx.query("select public.calendar_end_planner_session($1, $2)", [reference, sessions[0]]));
    const status = await asRole(db, "service_role", tx => tx.query<{ value: unknown }>(
      "select public.calendar_planner_session_context($1, $2) as value", [reference, sessions[0]],
    ));
    const other = await asRole(db, "service_role", tx => tx.query<{ value: unknown }>(
      "select public.calendar_planner_session_context($1, $2) as value", [reference, sessions[1]],
    ));
    expect(status.rows[0].value).toBeNull();
    expect(other.rows[0].value).not.toBeNull();
  });

  it("limits staff submission functions to active administrators", async () => {
    const { rows: [user] } = await db.query<{ id: string }>("insert into auth.users (email) values ('notstaff@example.org') returning id");
    await expect(asRole(db, "anon", tx => tx.query("select public.calendar_staff_plan_list()")))
      .rejects.toMatchObject({ code: "42501" });
    await expect(asRole(db, "authenticated", tx => tx.query("select public.calendar_staff_plan_list()"), user.id))
      .rejects.toMatchObject({ code: "RAR09" });
    const admin = await createStaff(db, "admin");
    const result = await asRole(db, "authenticated", tx => tx.query<{ plans: unknown[] }>("select public.calendar_staff_plan_list() as plans"), admin);
    expect(result.rows[0].plans).toHaveLength(1);
  });
});
