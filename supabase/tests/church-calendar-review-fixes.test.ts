import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asRole, createStaff, createTestDb } from "./support/db";

let db: PGlite;
let owner: string;
let reference: string;
let plan: string;
let timezone: string;
let days: string[];
let specificEvent: string;
let allDayEvent: string;
const grant = crypto.randomUUID();
const token = "61".repeat(32);
const session = "ab".repeat(32);

async function save(data: unknown, id: string | null = null) {
  return asRole(db, "service_role", tx => tx.query<{ id: string }>(
    "select public.calendar_save_event_draft($1, $2, $3, $4::jsonb) as id", [reference, session, id, JSON.stringify(data)],
  ));
}
async function portal() {
  const result = await asRole(db, "service_role", tx => tx.query<{ value: { events: Record<string, unknown>[] } }>(
    "select public.calendar_planner_portal($1, $2) as value", [reference, session],
  ));
  return result.rows[0].value;
}
async function submit(confirmEmpty = false) {
  return asRole(db, "service_role", tx => tx.query<{ revision: number }>(
    "select public.calendar_submit_plan($1, $2, '', $3) as revision", [reference, session, confirmEmpty],
  ));
}
const eventData = (title: string, schedule: Record<string, unknown>, dates: unknown[] = []) => ({
  title, scope: "ministry", visibility: "internal", location_type: "church", estimated_attendance: 10, schedule, dates,
});

beforeAll(async () => {
  db = await createTestDb();
  owner = await createStaff(db, "super_admin");
  const { rows: [settings] } = await db.query<{ timezone: string }>("select timezone from public.app_settings where id");
  timezone = settings.timezone;
  const { rows: [dateRow] } = await db.query<{ days: string[] }>(
    "select array(select (current_date + x)::text from generate_series(1, 10) x) as days",
  );
  days = dateRow.days;
  const { rows: [ministry] } = await db.query<{ id: string }>("select id from public.ministries where active limit 1");
  const { rows: [cycle] } = await asRole(db, "authenticated", tx => tx.query<{ id: string }>(
    "select public.save_calendar_cycle(null, 'Review fixes', current_date, current_date + 365, now() - interval '1 day', now() + interval '30 days', '') as id",
  ), owner);
  const created = await asRole(db, "authenticated", tx => tx.query<{ id: string }>("select public.add_calendar_ministry($1, $2) as id", [cycle.id, ministry.id]), owner);
  plan = created.rows[0].id;
  reference = (await db.query<{ reference_code: string }>("select reference_code from public.ministry_calendar_plans where id = $1", [plan])).rows[0].reference_code;
  await asRole(db, "authenticated", tx => tx.query("select public.transition_calendar_cycle($1, 'open', null)", [cycle.id]), owner);
  await asRole(db, "authenticated", tx => tx.query("select public.invite_calendar_planner($1, $2, 'Planner', 'review@example.org', null, 'additional', $3, $4)", [plan, grant, token, "33".repeat(16)]), owner);
  await asRole(db, "service_role", tx => tx.query("select public.exchange_calendar_planner_session($1, $2, $3, $4)", [reference, grant, token, session]));
  await db.query("update private.calendar_planner_policies set enabled = true, privacy_version = 'p1', terms_version = 't1'");
  await asRole(db, "service_role", tx => tx.query("select public.calendar_accept_planner_policies($1, $2, 'p1', 't1')", [reference, session]));
});
afterAll(async () => { await db.close(); });

describe("Phase 2 review fixes", () => {
  it("retains specific-date identities across edits and tombstones removed entries", async () => {
    const schedule = { kind: "specific_dates", timezone, all_day: false, start_date: days[0], end_date: days[9] };
    const entries = [
      { start_date: days[1], end_date: days[1], start_time: "09:00", end_time: "10:00" },
      { start_date: days[3], end_date: days[4], start_time: "13:00", end_time: "14:00" },
    ];
    specificEvent = (await save(eventData("Specific dates", schedule, entries))).rows[0].id;
    const first = (await portal()).events.find(e => e.id === specificEvent)!;
    const original = first.dates as { id: string; start_date: string; end_date: string; start_time: string; end_time: string }[];
    expect(original).toHaveLength(2);
    const updated = { ...first, dates: [{ ...original[0], start_date: days[2], end_date: days[2], start_time: "11:00", end_time: "12:00" },
      { start_date: days[5], end_date: days[5], start_time: "15:00", end_time: "16:00" }] };
    await save(updated, specificEvent);
    const after = (await portal()).events.find(e => e.id === specificEvent)!;
    const revised = after.dates as typeof original;
    expect(revised[0]).toMatchObject({ id: original[0].id, start_date: days[2], start_time: "11:00:00" });
    expect(revised[1].id).not.toBe(original[1].id);
    expect((await db.query<{ removed: boolean }>("select removed_at is not null as removed from public.calendar_schedule_dates where id = $1", [original[1].id])).rows[0].removed).toBe(true);
    const copy = await asRole(db, "service_role", tx => tx.query<{ id: string }>(
      "select public.calendar_duplicate_event_draft($1, $2, $3) as id", [reference, session, specificEvent],
    ));
    const copied = (await portal()).events.find(e => e.id === copy.rows[0].id)!.dates as typeof original;
    expect(copied.map(date => date.id)).not.toEqual(revised.map(date => date.id));
    expect(copied.map(date => date.start_date)).toEqual(revised.map(date => date.start_date));
    await asRole(db, "service_role", tx => tx.query("select public.calendar_remove_event_draft($1, $2, $3, 1)", [reference, session, copy.rows[0].id]));
    const otherEvent = (await save(eventData("Other event", { kind: "one_time", timezone, start_date: days[0], end_date: days[0], start_time: "09:00", end_time: "10:00" }))).rows[0].id;
    const other = (await portal()).events.find(e => e.id === otherEvent)!;
    await expect(save({ ...after, dates: [{ ...revised[0], id: original[1].id }] }, specificEvent)).rejects.toMatchObject({ code: "RAR09" });
    await expect(save({ ...other, schedule, dates: [revised[0]] }, otherEvent)).rejects.toMatchObject({ code: "RAR09" });
    await asRole(db, "service_role", tx => tx.query("select public.calendar_remove_event_draft($1, $2, $3, 1)", [reference, session, otherEvent]));
  });

  it("submits all-day events with no wall-clock times and snapshots each date", async () => {
    const timed = { kind: "specific_dates", timezone, all_day: false, start_date: days[0], end_date: days[9] };
    const incomplete = (await save(eventData("Missing time", timed, [{ start_date: days[1], end_date: days[1] }]))).rows[0].id;
    await expect(submit()).rejects.toMatchObject({ code: "RAR09" });
    await asRole(db, "service_role", tx => tx.query("select public.calendar_remove_event_draft($1, $2, $3, 1)", [reference, session, incomplete]));
    const allDay = { kind: "specific_dates", timezone, all_day: true, start_date: days[0], end_date: days[9] };
    allDayEvent = (await save(eventData("All day", allDay, [{ start_date: days[6], end_date: days[7] }]))).rows[0].id;
    await save(eventData("All-day single", { kind: "one_time", timezone, all_day: true, start_date: days[1], end_date: days[1] }));
    await save(eventData("All-day repeat", { kind: "recurring", timezone, all_day: true, start_date: days[0], end_date: days[9], frequency: "daily", interval_count: 1 }));
    expect((await submit()).rows[0].revision).toBe(1);
    const rows = await db.query<{ id: string; event_id: string; all_day: boolean; start_time: string | null }>(
      "select id, event_id, all_day, start_time from public.calendar_event_submissions where plan_revision = 1 order by title",
    );
    expect(rows.rows.find(row => row.event_id === allDayEvent)).toMatchObject({ all_day: true, start_time: null });
    const specific = rows.rows.find(row => row.event_id === specificEvent)!;
    const snapshotDates = await db.query<{ logical_date_id: string; local_start_time: string; local_end_date: string }>(
      "select logical_date_id, local_start_time::text, local_end_date::text from public.calendar_submission_dates where submission_id = $1 order by local_date", [specific.id],
    );
    const draftDates = ((await portal()).events.find(e => e.id === specificEvent)!.dates) as { id: string }[];
    expect(snapshotDates.rows.map(date => date.logical_date_id)).toEqual(draftDates.map(date => date.id));
    expect(snapshotDates.rows[0].local_start_time).toBe("11:00:00");
    await expect(db.query("update public.calendar_submission_dates set local_start_time = '12:00' where submission_id = $1", [specific.id])).rejects.toMatchObject({ code: "RAR09" });
  });

  it("withdraws a submitted event only during revision and retains its previous snapshots", async () => {
    await expect(asRole(db, "service_role", tx => tx.query("select public.calendar_remove_event_draft($1, $2, $3, 2)", [reference, session, specificEvent])))
      .rejects.toMatchObject({ code: "RAR09" });
    await asRole(db, "authenticated", tx => tx.query("select public.calendar_request_plan_changes($1, 'Remove this event')", [plan]), owner);
    const current = (await portal()).events.find(e => e.id === specificEvent)!;
    const selected = current.dates as { id: string; start_time: string }[];
    await save({ ...current, dates: [{ ...selected[0], start_time: "08:00" }, selected[1]] }, specificEvent);
    expect((await submit()).rows[0].revision).toBe(2);
    const versions = await db.query<{ plan_revision: number; logical_date_id: string; local_start_time: string }>(
      "select s.plan_revision, d.logical_date_id, d.local_start_time::text from public.calendar_event_submissions s join public.calendar_submission_dates d on d.submission_id = s.id where s.event_id = $1 and d.logical_date_id = $2 order by s.plan_revision", [specificEvent, selected[0].id],
    );
    expect(versions.rows).toEqual([
      { plan_revision: 1, logical_date_id: selected[0].id, local_start_time: "11:00:00" },
      { plan_revision: 2, logical_date_id: selected[0].id, local_start_time: "08:00:00" },
    ]);
    await asRole(db, "authenticated", tx => tx.query("select public.calendar_request_plan_changes($1, 'Remove this event')", [plan]), owner);
    await expect(asRole(db, "service_role", tx => tx.query("select public.calendar_remove_event_draft($1, $2, $3, 2)", [reference, session, specificEvent])))
      .rejects.toMatchObject({ code: "RAR09" });
    await asRole(db, "service_role", tx => tx.query("select public.calendar_remove_event_draft($1, $2, $3, 3)", [reference, session, specificEvent]));
    const beforeResubmit = await asRole(db, "authenticated", tx => tx.query<{ value: { events: { title: string }[] }[] }>("select public.calendar_staff_plan_list() as value"), owner);
    expect(beforeResubmit.rows[0].value[0].events.map(e => e.title)).toContain("Specific dates");
    expect((await submit()).rows[0].revision).toBe(3);
    const snapshots = await db.query<{ plan_revision: number }>("select plan_revision from public.calendar_event_submissions where event_id = $1 order by plan_revision", [specificEvent]);
    expect(snapshots.rows).toEqual([{ plan_revision: 1 }, { plan_revision: 2 }]);
    expect((await db.query<{ deleted: boolean }>("select deleted_at is not null as deleted from public.calendar_events where id = $1", [specificEvent])).rows[0].deleted).toBe(true);
    expect((await db.query<{ count: number }>("select count(*)::int as count from public.audit_logs where action = 'calendar_event.withdrawn' and entity_id = $1", [specificEvent])).rows[0].count).toBe(1);
    const after = await asRole(db, "authenticated", tx => tx.query<{ value: { events: { title: string }[] }[] }>("select public.calendar_staff_plan_list() as value"), owner);
    expect(after.rows[0].value[0].events.map(e => e.title).sort()).toEqual(["All day", "All-day repeat", "All-day single"]);
    await asRole(db, "authenticated", tx => tx.query("select public.calendar_request_plan_changes($1, 'Submit an empty plan')", [plan]), owner);
    for (const event of (await portal()).events) {
      await asRole(db, "service_role", tx => tx.query("select public.calendar_remove_event_draft($1, $2, $3, $4)", [reference, session, event.id, event.draft_version]));
    }
    await expect(submit()).rejects.toMatchObject({ code: "RAR09" });
    expect((await submit(true)).rows[0].revision).toBe(4);
    expect((await db.query<{ count: number }>("select count(*)::int as count from public.calendar_event_submissions where event_id = $1", [allDayEvent])).rows[0].count).toBe(3);
  });
});
