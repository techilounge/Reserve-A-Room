import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expandRecurrenceDates } from "@/lib/recurrence/dates";
import type { RecurrenceInput } from "@/lib/recurrence/types";
import { asRole, createRoom, createStaff, createTestDb } from "./support/db";

let db: PGlite;
let owner: string;
let plan: string;
let reference: string;
let timezone: string;
let year: number;
let specific: string;
let copy: string;
let weekly: string;
let allDay: string;
let multiDay: string;
let fallAllDay: string;
let roomA: string;
let roomB: string;
let resourceA: string;
let resourceB: string;
const token = "91".repeat(32);
const session = "92".repeat(32);
const grant = crypto.randomUUID();
const date = (month: number, day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

async function save(data: unknown, eventId: string | null = null) {
  return asRole(db, "service_role", tx => tx.query<{ id: string }>(
    "select public.calendar_save_event_draft($1, $2, $3, $4::jsonb) as id", [reference, session, eventId, JSON.stringify(data)],
  ));
}
async function submit() {
  return asRole(db, "service_role", tx => tx.query("select public.calendar_submit_plan($1, $2, '', false)", [reference, session]));
}
async function portal() {
  const result = await asRole(db, "service_role", tx => tx.query<{ value: { events: Record<string, unknown>[] } }>(
    "select public.calendar_planner_portal($1, $2) as value", [reference, session],
  ));
  return result.rows[0].value;
}
const eventData = (title: string, schedule: Record<string, unknown>, dates: unknown[] = []) => ({
  title, scope: "ministry", visibility: "internal", location_type: "church", estimated_attendance: 10,
  setup_minutes: 30, cleanup_minutes: 15, rooms: [roomA], resources: [{ id: resourceA, quantity: 2 }], schedule, dates,
});

beforeAll(async () => {
  db = await createTestDb();
  owner = await createStaff(db, "super_admin");
  const { rows: [settings] } = await db.query<{ timezone: string; year: number }>(
    "select timezone, extract(year from now())::integer + 1 as year from public.app_settings where id",
  );
  timezone = settings.timezone; year = settings.year;
  const ministry = (await db.query<{ id: string }>("select id from public.ministries where active limit 1")).rows[0].id;
  const cycle = (await asRole(db, "authenticated", tx => tx.query<{ id: string }>(
    "select public.save_calendar_cycle(null, 'Occurrence engine', $1, $2, now() - interval '1 day', now() + interval '30 days', '') as id", [date(1, 1), `${year + 1}-12-31`],
  ), owner)).rows[0].id;
  plan = (await asRole(db, "authenticated", tx => tx.query<{ id: string }>("select public.add_calendar_ministry($1, $2) as id", [cycle, ministry]), owner)).rows[0].id;
  reference = (await db.query<{ reference_code: string }>("select reference_code from public.ministry_calendar_plans where id = $1", [plan])).rows[0].reference_code;
  await asRole(db, "authenticated", tx => tx.query("select public.transition_calendar_cycle($1, 'open', null)", [cycle]), owner);
  await asRole(db, "authenticated", tx => tx.query("select public.invite_calendar_planner($1, $2, 'Planner', 'occurrences@example.org', null, 'additional', $3, $4)", [plan, grant, token, "93".repeat(16)]), owner);
  await asRole(db, "service_role", tx => tx.query("select public.exchange_calendar_planner_session($1, $2, $3, $4)", [reference, grant, token, session]));
  await db.query("update private.calendar_planner_policies set enabled = true, privacy_version = 'p1', terms_version = 't1'");
  await asRole(db, "service_role", tx => tx.query("select public.calendar_accept_planner_policies($1, $2, 'p1', 't1')", [reference, session]));
  roomA = await createRoom(db); roomB = await createRoom(db);
  const resources = await db.query<{ id: string }>("insert into public.calendar_resources(name, category, available_quantity) values ('Lights', 'equipment', 5), ('Sound', 'equipment', 5) returning id");
  [resourceA, resourceB] = resources.rows.map(row => row.id);
});
afterAll(async () => { await db.close(); });

describe("Church Calendar occurrence materialization", () => {
  it("rejects unsupported intervals in planner saves and keeps supported intervals configurable", async () => {
    const common = { kind: "recurring", timezone, all_day: true, start_date: date(1, 1), end_date: date(1, 15),
      weekdays: [1], weekday: 1, month_ordinals: [1], month_ordinal: 1, day_of_month: 1, month_of_year: 1 };
    for (const frequency of ["weekdays", "yearly_date", "yearly_nth_weekday"]) {
      for (const interval of [2, null]) {
        await expect(save(eventData("Tampered interval", { ...common, frequency, interval_count: interval })))
          .rejects.toMatchObject({ code: "23514", constraint: "calendar_schedules_fixed_interval_check" });
      }
      const id = (await save(eventData("Fixed interval", { ...common, frequency, interval_count: 1 }))).rows[0].id;
      expect((await db.query<{ interval_count: number }>("select interval_count from public.calendar_event_schedules where event_id=$1", [id])).rows[0].interval_count).toBe(1);
      await asRole(db, "service_role", tx => tx.query("select public.calendar_remove_event_draft($1,$2,$3,1)", [reference, session, id]));
    }
    for (const frequency of ["daily", "weekly", "monthly_day", "monthly_nth_weekday"]) {
      const id = (await save(eventData("Configurable interval", { ...common, frequency, interval_count: 2 }))).rows[0].id;
      expect((await db.query<{ interval_count: number }>("select interval_count from public.calendar_event_schedules where event_id=$1", [id])).rows[0].interval_count).toBe(2);
      await asRole(db, "service_role", tx => tx.query("select public.calendar_remove_event_draft($1,$2,$3,1)", [reference, session, id]));
    }
  });

  it("matches the existing recurrence rules over their shared one-year range", async () => {
    const rules: { rule: RecurrenceInput["rule"]; storage: Record<string, unknown>; through: string }[] = [
      { rule: { frequency: "daily", interval: 3 }, storage: { frequency: "daily", interval_count: 3 }, through: "2028-02-15" },
      { rule: { frequency: "weekdays" }, storage: { frequency: "weekdays", interval_count: 1 }, through: "2028-02-15" },
      { rule: { frequency: "weekly", interval: 2, weekdays: [1, 6] }, storage: { frequency: "weekly", interval_count: 2, weekdays: [1, 6] }, through: "2028-11-30" },
      { rule: { frequency: "monthly_day", interval: 1, dayOfMonth: 31 }, storage: { frequency: "monthly_day", interval_count: 1, day_of_month: 31 }, through: "2028-12-31" },
      { rule: { frequency: "monthly_nth_weekday", interval: 1, weekday: 6, ordinals: [2, 4, -1] }, storage: { frequency: "monthly_nth_weekday", interval_count: 1, weekday: 6, month_ordinals: [2, 4, -1] }, through: "2028-12-31" },
      { rule: { frequency: "yearly_date", month: 2, dayOfMonth: 29 }, storage: { frequency: "yearly_date", interval_count: 1, month_of_year: 2, day_of_month: 29 }, through: "2028-12-31" },
      { rule: { frequency: "yearly_nth_weekday", month: 11, weekday: 4, ordinal: 4 }, storage: { frequency: "yearly_nth_weekday", interval_count: 1, month_of_year: 11, weekday: 4, month_ordinal: 4 }, through: "2028-12-31" },
    ];
    for (const { rule, storage, through } of rules) {
      const input: RecurrenceInput = { startDate: "2028-01-01", endDate: through, start: "09:00", end: "10:00", rule };
      const expected = expandRecurrenceDates(input, { throughDate: through });
      const payload = JSON.stringify({ ...storage, start_date: input.startDate, end_date: through });
      const actual = await db.query<{ dates: string[] }>(`select coalesce(array_agg(g.day::date::text order by g.day), '{}') as dates
        from generate_series($1::timestamp, $2::timestamp, interval '1 day') g(day)
        where private.calendar_date_matches(jsonb_populate_record(null::public.calendar_event_submissions, $3::jsonb), g.day::date)`, [input.startDate, through, payload]);
      expect(actual.rows[0].dates).toEqual(expected);
    }
  });
  it("submits specific dates, all-day events and a DST-spanning recurrence without operational holds", async () => {
    const marchSunday = 1 + (7 - new Date(Date.UTC(year, 2, 1)).getUTCDay()) % 7 + 7;
    const novemberSunday = 1 + (7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7;
    const specificSchedule = { kind: "specific_dates", timezone, all_day: false, start_date: date(2, 1), end_date: date(2, 28) };
    specific = (await save(eventData("Specific", specificSchedule, [
      { start_date: date(2, 10), end_date: date(2, 10), start_time: "09:00", end_time: "10:00" },
      { start_date: date(2, 17), end_date: date(2, 17), start_time: "11:00", end_time: "12:00" },
    ]))).rows[0].id;
    const initial = await db.query<{ id: string; logical_occurrence_id: string }>(
      "select id, logical_occurrence_id from public.calendar_event_occurrences where event_id=$1 and status='scheduled' order by local_start", [specific],
    );
    expect(initial.rows).toHaveLength(2);
    let draft = (await portal()).events.find(row => row.id === specific)!;
    await asRole(db, "service_role", tx => tx.query("select public.calendar_set_occurrence_exception($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [reference, session, initial.rows[0].id, Number(draft.draft_version), "room", roomA, "remove", null, ""]));
    draft = (await portal()).events.find(row => row.id === specific)!;
    await save({ ...draft, rooms: [roomA, roomB] }, specific);
    expect((await db.query<{ room_id: string }>("select room_id from public.calendar_event_room_requests where occurrence_id=$1", [initial.rows[0].id])).rows.map(row => row.room_id)).toEqual([roomB]);
    expect((await db.query<{ logical_occurrence_id: string }>("select logical_occurrence_id from public.calendar_event_occurrences where id=$1", [initial.rows[0].id])).rows[0].logical_occurrence_id).toBe(initial.rows[0].logical_occurrence_id);
    draft = (await portal()).events.find(row => row.id === specific)!;
    await asRole(db, "service_role", tx => tx.query("select public.calendar_set_occurrence_exception($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [reference, session, initial.rows[0].id, Number(draft.draft_version), "room", roomA, "reset", null, ""]));
    draft = (await portal()).events.find(row => row.id === specific)!;
    await save({ ...draft, rooms: [roomA] }, specific);
    draft = (await portal()).events.find(row => row.id === specific)!;
    const originalDates = draft.dates as Record<string, unknown>[];
    await save({ ...draft, dates: [{ ...originalDates[0], start_time: "" }, originalDates[1]] }, specific);
    const incomplete = await asRole(db, "service_role", tx => tx.query<{ value: unknown[] }>(
      "select public.calendar_planner_occurrences($1,$2,$3) as value", [reference, session, specific],
    ));
    expect(incomplete.rows[0].value).toEqual([]);
    const incompleteDraft = (await portal()).events.find(row => row.id === specific)!;
    await expect(asRole(db, "service_role", tx => tx.query("select public.calendar_set_occurrence_exception($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [reference, session, initial.rows[0].id, Number(incompleteDraft.draft_version), "room", roomA, "remove", null, ""]))).rejects.toMatchObject({ code: "RAR09" });
    draft = (await portal()).events.find(row => row.id === specific)!;
    await save({ ...draft, dates: originalDates }, specific);
    copy = (await asRole(db, "service_role", tx => tx.query<{ id: string }>(
      "select public.calendar_duplicate_event_draft($1, $2, $3) as id", [reference, session, specific],
    ))).rows[0].id;
    allDay = (await save(eventData("All day", { kind: "one_time", timezone, all_day: true, start_date: date(4, 10), end_date: date(4, 10) }))).rows[0].id;
    multiDay = (await save(eventData("Multi day", { kind: "multi_day", timezone, all_day: true, start_date: date(3, marchSunday - 1), end_date: date(3, marchSunday + 1) }))).rows[0].id;
    fallAllDay = (await save(eventData("Fall all day", { kind: "one_time", timezone, all_day: true, start_date: date(11, novemberSunday), end_date: date(11, novemberSunday) }))).rows[0].id;
    weekly = (await save(eventData("Weekly", { kind: "recurring", timezone, all_day: false, start_date: date(3, 1), end_date: `${year + 1}-11-30`,
      start_time: "09:00", end_time: "10:00", frequency: "weekly", interval_count: 1, weekdays: [0] }))).rows[0].id;
    const before = (await db.query<{ count: number }>("select count(*)::int as count from public.reservations")).rows[0].count;
    await submit();
    expect((await db.query<{ count: number }>("select count(*)::int as count from public.reservations")).rows[0].count).toBe(before);
    const occurrences = await db.query<{ event_id: string; logical_occurrence_id: string; local_start: string; local_end: string; duration: number; setup: number; cleanup: number }>(
      "select event_id, logical_occurrence_id, local_start::text, local_end::text, extract(epoch from end_at-start_at)::int as duration, extract(epoch from start_at-occupancy_start)::int as setup, extract(epoch from occupancy_end-end_at)::int as cleanup from public.calendar_event_occurrences where status='scheduled' order by local_start",
    );
    const single = occurrences.rows.find(row => row.event_id === allDay)!;
    const multi = occurrences.rows.find(row => row.event_id === multiDay)!;
    const fall = occurrences.rows.find(row => row.event_id === fallAllDay)!;
    expect(single.duration).toBe(86400); expect(multi.duration).toBe(71 * 3600); expect(fall.duration).toBe(25 * 3600);
    expect(single.setup).toBe(1800); expect(single.cleanup).toBe(900);
    const originalIds = occurrences.rows.filter(row => row.event_id === specific).map(row => row.logical_occurrence_id);
    const copyIds = occurrences.rows.filter(row => row.event_id === copy).map(row => row.logical_occurrence_id);
    expect(originalIds).toHaveLength(2); expect(copyIds).toHaveLength(2);
    expect(copyIds.some(id => originalIds.includes(id))).toBe(false);
    const dst = await db.query<{ local_start: string; utc_hour: number }>(
      "select local_start::text, extract(hour from start_at at time zone 'UTC')::int as utc_hour from public.calendar_event_occurrences where event_id=$1 order by local_start", [weekly],
    );
    expect(dst.rows.length).toBeGreaterThan(80);
    expect(dst.rows.every(row => row.local_start.endsWith("09:00:00"))).toBe(true);
    expect(new Set(dst.rows.map(row => row.utc_hour))).toEqual(new Set([14, 15]));
    const hour = (day: string) => dst.rows.find(row => row.local_start.startsWith(day))?.utc_hour;
    expect(hour(date(3, marchSunday - 7))).toBe(15);
    expect(hour(date(3, marchSunday))).toBe(14);
    expect(hour(date(11, novemberSunday))).toBe(15);
    const priorSunday = new Date(Date.UTC(year, 10, novemberSunday - 7)).toISOString().slice(0, 10);
    expect(hour(priorSunday)).toBe(14);
    const ambiguous = await db.query<{ instant: string }>("select private.calendar_local_instant($1::timestamp, $2)::text as instant", [`${date(11, novemberSunday)} 01:30:00`, timezone]);
    expect(new Date(ambiguous.rows[0].instant).toISOString()).toBe(`${date(11, novemberSunday)}T07:30:00.000Z`);
    expect((await db.query<{ count: number }>("select count(*)::int as count from public.calendar_event_room_requests r join public.calendar_event_occurrences o on o.id=r.occurrence_id where o.status='scheduled'")).rows[0].count).toBe(occurrences.rows.length);
    const snapshot = await db.query<{ count: number }>("select count(*)::int as count from public.calendar_submission_occurrences");
    expect(snapshot.rows[0].count).toBe(occurrences.rows.length);
  });

  it("is idempotent and protects immutable submission occurrence and request history", async () => {
    const submission = (await db.query<{ id: string }>("select id from public.calendar_event_submissions where event_id=$1 and plan_revision=1", [specific])).rows[0].id;
    for (const frequency of ["weekdays", "yearly_date", "yearly_nth_weekday"]) {
      await expect(db.query(`insert into public.calendar_event_submissions
        select (jsonb_populate_record(null::public.calendar_event_submissions, to_jsonb(s) ||
          jsonb_build_object('id', gen_random_uuid(), 'plan_revision', 100, 'schedule_kind', 'recurring', 'frequency', $2::text, 'interval_count', 2))).*
        from public.calendar_event_submissions s where s.id=$1`, [submission, frequency]))
        .rejects.toMatchObject({ code: "23514", constraint: "calendar_submissions_fixed_interval_check" });
    }
    const before = (await db.query<{ count: number }>("select count(*)::int as count from public.calendar_submission_occurrences where submission_id=$1", [submission])).rows[0].count;
    await db.query("select private.calendar_materialize_submission($1)", [submission]);
    expect((await db.query<{ count: number }>("select count(*)::int as count from public.calendar_submission_occurrences where submission_id=$1", [submission])).rows[0].count).toBe(before);
    await expect(db.query("delete from public.calendar_submission_occurrences where submission_id=$1", [submission])).rejects.toMatchObject({ code: "RAR09" });
    for (const role of ["anon", "authenticated", "service_role"] as const) {
      await expect(asRole(db, role, tx => tx.query("select * from public.calendar_event_occurrences"))).rejects.toMatchObject({ code: "42501" });
    }
    await expect(asRole(db, "anon", tx => tx.query("select public.calendar_staff_occurrences($1)", [submission])))
      .rejects.toMatchObject({ code: "42501" });
    const staffResult = await asRole(db, "authenticated", tx => tx.query<{ value: unknown[] }>("select public.calendar_staff_occurrences($1) as value", [submission]), owner);
    expect(staffResult.rows[0].value).toHaveLength(before);
    await expect(asRole(db, "service_role", tx => tx.query("select public.calendar_planner_occurrences($1, $2, $3)", [reference, session, crypto.randomUUID()])))
      .rejects.toMatchObject({ code: "RAR09" });
  });

  it("retains a selected-date identity, supersedes removed dates, and freezes exception-adjusted requests", async () => {
    await asRole(db, "authenticated", tx => tx.query("select public.calendar_request_plan_changes($1, 'Revise schedule')", [plan]), owner);
    const event = (await portal()).events.find(row => row.id === specific)!;
    const dates = event.dates as { id: string; start_time: string }[];
    const old = await db.query<{ id: string; logical_occurrence_id: string; source_date_id: string }>(
      "select id, logical_occurrence_id, source_date_id from public.calendar_event_occurrences where event_id=$1 and status='scheduled' order by local_start", [specific],
    );
    await save({ ...event, dates: [{ ...dates[0], start_time: "08:00" }] }, specific);
    let version = Number((await portal()).events.find(row => row.id === specific)!.draft_version);
    await expect(asRole(db, "anon", tx => tx.query("select public.calendar_set_occurrence_exception($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [reference, session, old.rows[0].id, version, "room", roomA, "remove", null, ""]))).rejects.toMatchObject({ code: "42501" });
    await expect(asRole(db, "service_role", tx => tx.query("select public.calendar_set_occurrence_exception($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [reference, session, old.rows[0].id, version - 1, "room", roomA, "remove", null, ""]))).rejects.toMatchObject({ code: "RAR09" });
    await expect(asRole(db, "service_role", tx => tx.query("select public.calendar_set_occurrence_exception($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [reference, session, old.rows[0].id, null, "room", roomA, "remove", null, ""]))).rejects.toMatchObject({ code: "RAR09" });
    await expect(asRole(db, "service_role", tx => tx.query("select public.calendar_set_occurrence_exception($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [crypto.randomUUID(), session, old.rows[0].id, version, "room", roomA, "remove", null, ""]))).rejects.toMatchObject({ code: "RAR09" });
    const exception = async (kind: string, id: string, operation: string, quantity: number | null) => {
      const result = await asRole(db, "service_role", tx => tx.query<{ version: number }>(
        "select public.calendar_set_occurrence_exception($1,$2,$3,$4,$5,$6,$7,$8,$9) as version",
        [reference, session, old.rows[0].id, version, kind, id, operation, quantity, "test"],
      ));
      version = result.rows[0].version;
    };
    await exception("room", roomA, "remove", null); await exception("room", roomB, "add", null);
    await exception("resource", resourceA, "quantity_override", 4);
    await exception("resource", resourceA, "reset", null);
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.calendar_occurrence_resource_exceptions where occurrence_id=$1 and resource_id=$2", [old.rows[0].id, resourceA])).rows[0].n).toBe(0);
    await exception("resource", resourceA, "quantity_override", 4); await exception("resource", resourceB, "add", 3);
    const beforeResubmit = await db.query<{ room_id: string }>("select room_id from public.calendar_event_room_requests where occurrence_id=$1", [old.rows[0].id]);
    expect(beforeResubmit.rows).toEqual([{ room_id: roomB }]);
    await db.query("update public.rooms set active = false where id=$1", [roomB]);
    const visible = await asRole(db, "service_role", tx => tx.query<{ value: { id: string; rooms: { id: string }[]; room_exceptions: { id: string; active: boolean }[] }[] }>(
      "select public.calendar_planner_occurrences($1,$2,$3) as value", [reference, session, specific],
    ));
    expect(visible.rows[0].value.find(row => row.id === old.rows[0].id)?.room_exceptions.find(item => item.id === roomB)?.active).toBe(false);
    expect(visible.rows[0].value.find(row => row.id === old.rows[0].id)?.rooms.map(item => item.id)).toEqual([roomB]);
    await expect(submit()).rejects.toMatchObject({ code: "RAR09", message: "An event contains an unavailable room, resource, or ministry." });
    await db.query("update public.rooms set active = true where id=$1", [roomB]);
    const withDefaults = (await portal()).events.find(row => row.id === specific)!;
    await save({ ...withDefaults, resources: [] }, specific);
    await expect(submit()).rejects.toMatchObject({ code: "RAR09", message: "An occurrence resource override needs an event-wide default." });
    const noDefaults = (await portal()).events.find(row => row.id === specific)!;
    await save({ ...noDefaults, resources: withDefaults.resources }, specific);
    await submit();
    const submitted = await asRole(db, "service_role", tx => tx.query<{ value: { id: string; rooms: { id: string }[] }[] }>(
      "select public.calendar_planner_occurrences($1,$2,$3) as value", [reference, session, specific],
    ));
    expect(submitted.rows[0].value.find(row => row.id === old.rows[0].id)?.rooms.map(item => item.id)).toEqual([roomB]);
    const nowRows = await db.query<{ id: string; logical_occurrence_id: string; status: string; local_start: string }>(
      "select id, logical_occurrence_id, status, local_start::text from public.calendar_event_occurrences where event_id=$1 order by local_start", [specific],
    );
    expect(nowRows.rows.find(row => row.id === old.rows[0].id)).toMatchObject({ logical_occurrence_id: old.rows[0].logical_occurrence_id, status: "scheduled" });
    expect(nowRows.rows.find(row => row.id === old.rows[0].id)?.local_start.endsWith("08:00:00")).toBe(true);
    expect(nowRows.rows.find(row => row.id === old.rows[1].id)?.status).toBe("superseded");
    const rooms = await db.query<{ room_id: string }>("select room_id from public.calendar_event_room_requests where occurrence_id=$1", [old.rows[0].id]);
    expect(rooms.rows).toEqual([{ room_id: roomB }]);
    const resources = await db.query<{ resource_id: string; quantity_requested: number }>("select resource_id, quantity_requested from public.calendar_event_resource_requests where occurrence_id=$1 order by quantity_requested", [old.rows[0].id]);
    expect(resources.rows).toEqual([{ resource_id: resourceB, quantity_requested: 3 }, { resource_id: resourceA, quantity_requested: 4 }]);
    const oldSnapshot = await db.query<{ local_start: string }>(
      "select o.local_start::text from public.calendar_submission_occurrences o join public.calendar_event_submissions s on s.id=o.submission_id where s.event_id=$1 and s.plan_revision=1 and o.occurrence_id=$2", [specific, old.rows[0].id],
    );
    expect(oldSnapshot.rows[0].local_start.endsWith("09:00:00")).toBe(true);
    expect((await db.query<{ count: number }>("select count(*)::int as count from public.calendar_submission_room_requests r join public.calendar_submission_occurrences o on o.id=r.submission_occurrence_id join public.calendar_event_submissions s on s.id=o.submission_id where s.event_id=$1 and s.plan_revision=1 and r.room_id=$2", [specific, roomA])).rows[0].count).toBe(2);
  });

  it("rejects a nonexistent spring-forward time and rolls back the whole submission", async () => {
    await asRole(db, "authenticated", tx => tx.query("select public.calendar_request_plan_changes($1, 'Add event')", [plan]), owner);
    const marchSunday = 1 + (7 - new Date(Date.UTC(year, 2, 1)).getUTCDay()) % 7 + 7;
    const springDate = date(3, marchSunday);
    const invalid = (await save(eventData("DST gap", { kind: "one_time", timezone, all_day: false,
      start_date: springDate, end_date: springDate, start_time: "02:30", end_time: "03:30" }))).rows[0].id;
    const countBefore = (await db.query<{ n: number }>("select count(*)::int as n from public.calendar_submission_occurrences")).rows[0].n;
    await expect(submit()).rejects.toMatchObject({ code: "RAR09", message: "A calendar event uses a nonexistent local time." });
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.calendar_submission_occurrences")).rows[0].n).toBe(countBefore);
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.calendar_event_occurrences where event_id=$1", [invalid])).rows[0].n).toBe(0);
  });

  it("supersedes future occurrences when an entire submitted event is withdrawn", async () => {
    // The previous test deliberately left an invalid draft; remove it before submitting.
    const invalid = (await portal()).events.find(row => row.title === "DST gap")!;
    await asRole(db, "service_role", tx => tx.query("select public.calendar_remove_event_draft($1,$2,$3,$4)", [reference, session, invalid.id, invalid.draft_version]));
    const copied = (await portal()).events.find(row => row.id === copy)!;
    const originalSnapshots = (await db.query<{ n: number }>("select count(*)::int as n from public.calendar_submission_occurrences o join public.calendar_event_submissions s on s.id=o.submission_id where s.event_id=$1", [copy])).rows[0].n;
    await asRole(db, "service_role", tx => tx.query("select public.calendar_remove_event_draft($1,$2,$3,$4)", [reference, session, copy, copied.draft_version]));
    await submit();
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.calendar_event_occurrences where event_id=$1 and status='scheduled'", [copy])).rows[0].n).toBe(0);
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.calendar_event_occurrences where event_id=$1 and status='superseded'", [copy])).rows[0].n).toBe(2);
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.calendar_submission_occurrences o join public.calendar_event_submissions s on s.id=o.submission_id where s.event_id=$1", [copy])).rows[0].n).toBe(originalSnapshots);
  });

  it("rejects the 1,201st candidate without writing occurrences or changing reservation limits", async () => {
    const submission = (await db.query<{ id: string }>(`insert into public.calendar_event_submissions(
      event_id, plan_revision, submitted_by_grant, title, category, scope, protection, visibility, location_type,
      estimated_attendance, food_drinks_planned, setup_minutes, cleanup_minutes, schedule_kind, timezone,
      start_date, end_date, start_time, end_time, all_day)
      select event_id, 999, submitted_by_grant, title, category, scope, protection, visibility, location_type,
        estimated_attendance, food_drinks_planned, setup_minutes, cleanup_minutes, 'specific_dates', timezone,
        start_date, end_date, null, null, true from public.calendar_event_submissions
      where event_id=$1 and plan_revision=1 returning id`, [allDay])).rows[0].id;
    await db.query(`insert into public.calendar_submission_dates(submission_id, logical_date_id, local_date, local_end_date)
      select $1, gen_random_uuid(), $2::date, $2::date from generate_series(1, 1201)`, [submission, date(4, 10)]);
    await expect(db.query("select private.calendar_materialize_submission($1)", [submission]))
      .rejects.toMatchObject({ code: "RAR09", message: "A calendar event may have at most 1200 occurrences." });
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.calendar_submission_occurrences where submission_id=$1", [submission])).rows[0].n).toBe(0);
    const legacy = await db.query<{ allowed: boolean }>(
      "select private.recurrence_date_matches('daily',1::smallint,null,null,null,null,null,null,$1::date,null,($1::date + interval '1 year 1 day')::date) as allowed", [date(1, 1)],
    );
    expect(legacy.rows[0].allowed).toBe(false);
    expect((await db.query<{ name: string | null }>("select to_regclass('public.calendar_resource_allocations')::text as name")).rows[0].name).toBeNull();
  });

  it("accepts exactly 1,200 explicit occurrences without creating reservations", async () => {
    const submission = (await db.query<{ id: string }>(`insert into public.calendar_event_submissions(
      event_id, plan_revision, submitted_by_grant, title, category, scope, protection, visibility, location_type,
      estimated_attendance, food_drinks_planned, setup_minutes, cleanup_minutes, schedule_kind, timezone,
      start_date, end_date, start_time, end_time, all_day)
      select event_id, 998, submitted_by_grant, title, category, scope, protection, visibility, location_type,
        estimated_attendance, food_drinks_planned, setup_minutes, cleanup_minutes, 'specific_dates', timezone,
        start_date, end_date, null, null, true from public.calendar_event_submissions
      where event_id=$1 and plan_revision=1 returning id`, [allDay])).rows[0].id;
    await db.query(`insert into public.calendar_submission_dates(submission_id, logical_date_id, local_date, local_end_date)
      select $1, gen_random_uuid(), $2::date, $2::date from generate_series(1, 1200)`, [submission, date(4, 10)]);
    const before = (await db.query<{ n: number }>("select count(*)::int as n from public.reservations")).rows[0].n;
    await db.query("select private.calendar_materialize_submission($1)", [submission]);
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.calendar_submission_occurrences where submission_id=$1", [submission])).rows[0].n).toBe(1200);
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.reservations")).rows[0].n).toBe(before);
  }, 120_000);
});
